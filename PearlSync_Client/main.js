global.client = [];
global.machineInfo = null;
global.connectionsConfs = [];
global.socket = [];

const fs = require('fs');
const path = require('path');
const md5 = require('md5');
const zip = new require('node-zip')();
const unzip = new require('unzip');
const os = require('os');
const net = require('net');
const watch = require('node-watch');
const node_machine_id = require('node-machine-id');
const local_client_to_main_server_connection = require('./local_client');
const local_server = require('./local_server');
const pearlsync_tools = require('./pearlsync_tools');

var debug_browser = false;

function processArgs(args) {

    var server_ip = "";
    var server_port = 0;

    var changedConfigJSON = false;

    args = args.split(',');

    for (var i = 0; i < args.length; i++) {

        if ( args[i].indexOf('factory_reset=true') != -1 ) {
            var files = ['local_data/instructions.json', 'local_data/invitations.json', 'local_data/machine.json', 'local_data/sharelist.json'];
            for (var j = 0; j < files.length; j++) {
                fs.unlinkSync(files[j]);
                createFileIfNotExists(files[j], "[]");
            }
            cleanDirectory('local_data/shares/');
        } else if ( args[i].indexOf('server_ip=') != -1 ) {
            changedConfigJSON = true;
            server_ip = args[i].substring(args[i].indexOf("=")+1, args[i].length);
        } else if ( args[i].indexOf('server_port=') != -1 ) {
            changedConfigJSON = true;
            server_port = parseFloat(args[i].substring(args[i].indexOf("=")+1, args[i].length));
        } else if ( args[i].indexOf('debug_browser=true') != -1 ) {
            debug_browser = true;
        }

    }

    if ( changedConfigJSON ) {

        pearlsync_tools.createFileIfNotExists('config.json', "{}");
        var configs = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

        configs.server_ip = server_ip;
        configs.server_default_port = server_port;

        fs.writeFileSync('config.json', JSON.stringify(configs));

    }

}
processArgs(process.argv+'');

local_server.startLocalServer();

const {app, BrowserWindow, ipcMain, dialog} = require('electron');

dialog.showErrorBox = function(title, content) {
    console.log(`${title}\n${content}`);
};

var watcher = [];
var instructionsBeingProcessed = false;

// Report crashes to our server.
//require('crash-reporter').start();

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is GCed.
global.mainWindow = null;

var server_ip = "";
var server_default_port = 0;

// Quit when all windows are closed.
app.on('window-all-closed', function() {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform != 'darwin') {
        app.quit();
    }
});

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on('ready', function() {

    // Create the browser window.
    global.mainWindow = new BrowserWindow({width: 800, height: 600});
    global.mainWindow.maximize();

    // and load the index.html of the app.
    global.mainWindow.loadURL('file://'+__dirname+'/index.html');

    if ( debug_browser ) {
        // Open the devtools.
        global.mainWindow.openDevTools();
    }
    
    // Emitted when the window is closed.
    global.mainWindow.on('closed', function() {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        global.mainWindow = null;
    });

    var configs = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
    server_ip = configs.server_ip;
    server_default_port = configs.server_default_port;

    checkForMachineId();

    setInterval(function() {

        var instructions = JSON.parse(fs.readFileSync('local_data/instructions.json', 'utf-8'));

        if ( !instructionsBeingProcessed ) {
            sendInstructionsToPairs(instructions);
        }

    }, 120000);

});

//-------------------------------------------------------------------

function startSharesProcessing() {

    // Get list of shares
    var share_list = JSON.parse(fs.readFileSync("local_data/sharelist.json", "utf-8"));

    // Get list of share files
    fs.readdir('local_data/shares/', (err, local_shares_files) => {

        for (var i = 0; i < share_list.length; i++) {

            var oldest_date = 0;
            var dates = [];

            // Get related files and process json 
            for (var j = 0; j < local_shares_files.length; j++) {
                if ( local_shares_files[j] !== ".DS_Store" ) {
                    var hash_from_filename = local_shares_files[j].substring(0, local_shares_files[j].indexOf("_"));
                    if ( share_list[i].hash === hash_from_filename ) {
                        var ldate = local_shares_files[j].substring(local_shares_files[j].indexOf("_")+1, local_shares_files[j].indexOf(".json"));
                        dates.push(parseFloat(ldate));
                    }
                }
            }
            dates.sort(function(a, b){return a - b});
            oldest_date = dates[0];

            // Remove intermediate shares
            for (var k = 1; k < dates.length; k++) {
                var file_to_delete_name = share_list[i].hash+"_"+dates[k]+".json.zip";
                fs.unlink('local_data/shares/'+file_to_delete_name, (err) => {
                    if (err) {
                        throw err;
                    } else {
                        console.log('local_data/shares/'+file_to_delete_name+' was deleted');
                    }
                });
            }

            // Check for oldest share structure
            var oldest_filename = share_list[i].hash+"_"+oldest_date+".json";

            var sharelist_obj = {"path": share_list[i].path, "hash": share_list[i].hash};
            fs.createReadStream('local_data/shares/'+oldest_filename+'.zip')
                .pipe(unzip.Extract({path:'local_data/shares/'}).on('close', function () {
                    sharesProcessingContinuation(oldest_filename, sharelist_obj);
                }));

            console.log("Starting connection to server!");
            local_client_to_main_server_connection.startConnectionToServer(server_ip, server_default_port);

        }

    });

}

function sharesProcessingContinuation(oldest_filename, sharelist_obj) {

    var oldest_structure = JSON.parse(fs.readFileSync('local_data/shares/'+oldest_filename, 'utf-8'));
        
    fs.unlink('local_data/shares/'+oldest_filename, (err) => {
        if (err) {
            throw err;
        } else {
            console.log('local_data/shares/'+oldest_filename+' was deleted');
        }
    });
                
    // Process current data structure
    var current_structure = processFolderStructure(sharelist_obj.path, sharelist_obj.hash);

    // Compare with current share structure
    pearlsync_tools.createFileIfNotExists('local_data/instructions.json', '[]');
    var oldInstructions = JSON.parse(fs.readFileSync('local_data/instructions.json', 'utf-8'));
    var newInstructions = compareStructures(oldest_structure, current_structure, []);

    // Starts to watch files for modifications
    watcher[sharelist_obj.hash] = watch(sharelist_obj.path, {recursive: true});
    watcher[sharelist_obj.hash].on('change', function(evt, name) {
        
        var op = "";
        if ( evt === "update" ) {
            op = "add";
        } else if ( evt === "remove" ) {
            op = "remove";
        }

        var type = "";
        if ( fs.lstatSync(name).isDirectory() ) {
            type = "folder";
        } else {
            type = "file";
        }

        oldInstructions.push({'op': op, 'path': name, 'execution': 0, 'type': type});

        // Update instructions file
        fs.writeFile("local_data/instructions.json", JSON.stringify(oldInstructions), function(err) {
            if (err) {
                return console.log(err);
            } else {
                if ( !instructionsBeingProcessed ) {
                    instructionsBeingProcessed = true;
                    setTimeout(function() {
                        sendInstructionsToPairs(oldInstructions);
                    }, 10000);
                }
            }
        });

    });

    // Check if there are similar instructions already pending
    for (var i = 0; i < newInstructions.length; i++) {
        for (var j = 0; j < oldInstructions.length; j++) {
            if ( newInstructions[i].op === oldInstructions[i].op || newInstructions[i].path === oldInstructions[i].path || newInstructions[i].execution === oldInstructions[i].execution || newInstructions[i].type === oldInstructions[i].type ) {
            } else {
                oldInstructions.push(newInstructions[i]);
            }
        }
    }
    newInstructions = null;

    // Save updated instructions set
    fs.writeFile("local_data/instructions.json", JSON.stringify(oldInstructions), function(err) {
        if (err) {
            return console.log(err);
        } else {
            if ( !instructionsBeingProcessed ) {
                instructionsBeingProcessed = true;
                setTimeout(function() {
                    sendInstructionsToPairs(oldInstructions);
                }, 10000);
            }
        }
    });

    // When processing is done, delete oldest share structure
    fs.unlink('local_data/shares/'+oldest_filename+".zip", (err) => {
        if (err) {
            throw err;
        } else {
            console.log('local_data/shares/'+oldest_filename+'.zip was deleted');
        }
    });

}

function compareStructures(oldStructure, currentStructure, instructions) {

    for (var i = 0; i < oldStructure.length; i++) {
        
        var removed = true;
        var changed = false;
        for (var j = 0; j < currentStructure.length; j++) {
            if ( oldStructure[i].path === currentStructure[j].path && oldStructure[i].type === currentStructure[j].type ) {
                removed = false;
                if ( oldStructure[i].type === 'folder' ) {
                    compareStructures(oldStructure[i].children, currentStructure[j].children, instructions);
                } else if ( oldStructure[i].type === 'file' ) {
                    if ( oldStructure[i].last_modification !== currentStructure[j].last_modification ) {
                        changed = true;
                    }
                }
                break;
            }
        }

        if ( removed ) {
            instructions.push({'op': 'remove', 'path': oldStructure[i].path, 'execution': 0, 'type': oldStructure[i].type});
        } else if ( changed ) {
            instructions.push({'op': 'change', 'path': oldStructure[i].path, 'execution': 0, 'type': oldStructure[i].type});
        }

    }

    for (var i = 0; i < currentStructure.length; i++) {

        var added = true;
        for (var j = 0; j < oldStructure.length; j++) {
            if ( oldStructure[j].path === currentStructure[i].path && oldStructure[j].type === currentStructure[i].type ) {
                added = false;
                break;
            }
        }

        if ( added ) {
            instructions.push({'op': 'add', 'path': currentStructure[i].path, 'execution': 0, 'type': currentStructure[i].type});
        }

    }

    return instructions;

}

function checkForMachineId() {
    
    var machinIdFilePath = 'local_data/machine.json';
    if (fs.existsSync(machinIdFilePath)) {
        
        global.machineInfo = JSON.parse(fs.readFileSync(machinIdFilePath, 'utf-8'));
        console.group("Readed machine id: "+global.machineInfo.id);

        if ( typeof global.machineInfo.id === 'undefined' ) {
            //console.log("No machine id found (2)");
            createNewMachineId();
        } else {

            var interfaces = os.networkInterfaces();
            var addresses = [];
            for (var k in interfaces) {
                for (var k2 in interfaces[k]) {
                    var address = interfaces[k][k2];
                    if (/*address.family === 'IPv4' &&*/ !address.internal) {
                        addresses.push(address.address);
                    }
                }
            }

            global.machineInfo.local_ip = addresses;
            console.log("The local IP Addresses are "+JSON.stringify(global.machineInfo.local_ip));

            startSharesProcessing();
            checkForConfiguredShares();

        }

    } else {

        console.log("No machine id found (1)");
        createNewMachineId();
        
    }

}

function createNewMachineId() {

    //console.log("Creating a new one");
    global.machineInfo = {"id": node_machine_id.machineIdSync(), "hostname": os.hostname()};
    //console.log("global.machineInfo.id: "+global.machineInfo.id);

    fs.writeFileSync("local_data/machine.json", JSON.stringify(global.machineInfo));
    checkForConfiguredShares();

}

function checkForConfiguredShares() {
    fs.readdir('local_data/shares/', (err, local_shares_files) => {
        if ( local_shares_files.length == 0 ) {
            //console.log("No pair found");
            global.mainWindow.webContents.executeJavaScript("callModalAddNewShare();");
        }
    });
}

ipcMain.on('createNewShare', (event, path) => {
    
    var now = new Date().getTime;
    var hash = md5(path+now);

    // ------- Register new share on server share list --------------
    global.client['server'].write(
        JSON.stringify({
            'op': 'postNewShare',
            'hash': hash,
            'machineid': global.machineInfo.id,
            'hostname': global.machineInfo.hostname,
            'path': path,
            'local_ip': global.machineInfo.local_ip
        }));

});

ipcMain.on('importNewShare', (event, data) => {
    
    var data = JSON.parse(data);

    // ------- Register new share on server share list --------------
    global.client['server'].write(
        JSON.stringify({
            'op': 'importNewShare',
            'invitation_hash': data.invitation_hash,
            'machineid': global.machineInfo.id,
            "hostname": global.machineInfo.hostname,
            "path": data.folderpath,
            'hostname': global.machineInfo.hostname,
            'local_ip': global.machineInfo.local_ip
        }));

});

function tryPunchConnection(data, punchConf) {

    punch_time = 0;

    global.client['server'].write(
        JSON.stringify({
            'op': 'sendPunchRequest',
            'machineid': global.machineInfo.id,
            'hostname': global.machineInfo.hostname,
            'data': {
                'punchOriginIP': data.originip,
                'punchOriginPort': data.originport,
                'punchDestinyIP': punchConf,
                'punchDestinyPort': punchConf
            },
            'local_ip': global.machineInfo.local_ip
        }));

};

function processFolderStructure(path, hash) {
                
    var ldate = (new Date()).getTime();

    var folderStructure = dirTree(path);
    var folderStructureStr = JSON.stringify(folderStructure);

    fs.writeFileSync('local_data/shares/'+hash+"_"+ldate+'.json', folderStructureStr);

    // ----- ZIP FILE -------------------
    zip.file(hash+"_"+ldate+'.json', folderStructureStr);
    var data2 = zip.generate({base64:false,compression:'DEFLATE'});
    fs.writeFileSync('local_data/shares/'+hash+"_"+ldate+'.json.zip', data2, 'binary');

    fs.unlink('local_data/shares/'+hash+"_"+ldate+'.json', (err) => {
        if (err) throw err;
        console.log('local_data/shares/'+hash+"_"+ldate+'.json was deleted');
    });

    return folderStructure;

}

function getShareList() {

    if ( global.machineInfo == null ) {

        console.log("machineInfo == null");
        setTimeout(getShareList, 1000);

    } else {

        pearlsync_tools.createFileIfNotExists('local_data/sharelist.json', '[]');

        // Build the post string from an object
        pearlsync_tools.executeGetShareList(JSON.parse(fs.readFileSync('local_data/sharelist.json', 'utf-8')));
    
    }

}

function getInvitationsList() {

    createFileIfNotExists('local_data/invitations.json', '[]');
    createFileIfNotExists('local_data/sharelist.json', '[]');

    var retObj = {"invitations": JSON.parse(fs.readFileSync('local_data/invitations.json', 'utf-8')), "shares": JSON.parse(fs.readFileSync('local_data/sharelist.json', 'utf-8'))};
    global.mainWindow.webContents.executeJavaScript("returnLoadInvitationsList("+JSON.stringify(retObj)+")");

}

ipcMain.on('getInvitationsList', (event, variable) => {
    getInvitationsList();
});

ipcMain.on('getShareList', (event, variable) => {
    getShareList();
});

ipcMain.on('saveShareInvitation', (event, variable) => {
    var id_hash = md5(global.machineInfo.id+(new Date()).getTime()+variable);
    global.client['server'].write(
        JSON.stringify({
            'op': 'saveShareInvitation',
            'id': id_hash,
            'share_hash': variable,
            'machineid': global.machineInfo.id,
            'hostname': global.machineInfo.hostname,
            'local_ip': global.machineInfo.local_ip
        }));
});

function dirTree(filename) {

    var stats = fs.lstatSync(filename);
    var info = {path: filename, name: path.basename(filename)};

    if (stats.isDirectory()) {
        info.type = "folder";
        info.children = fs.readdirSync(filename).map(function(child) {
            return dirTree(filename + '/' + child);
        });
    } else {
        // Assuming it's a file. In real life it could be a symlink or
        // something else!
        info.type = "file";
        info.last_modification = stats.mtimeMs;
    }

    return info;

}

function sendInstructionsToPairs(instructions) {

    instructionsBeingProcessed = true;

    for (var i = 0; i < instructions.length; i++) {



    }

    instructionsBeingProcessed = false;

}

function cleanDirectory(directory) {

    fs.readdir(directory, (err, files) => {

        if (err) {
            throw err;
        }

        for (const file of files) {
            fs.unlink(path.join(directory, file), err => {
                if (err) {
                    throw err;
                }
            });
        }

    });

}