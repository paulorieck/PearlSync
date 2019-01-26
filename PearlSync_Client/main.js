global.client = [];
global.machineInfo = null;
global.connectionsConfs = [];
global.socket = [];
global.instructionsBeingProcessed = false;
global.transaction_syze = 1024*1024; // 1 Mbyte
global.received_files = [];
global.watch_suppress_list = [];
global.base64 = [];
global.sending_data = false;
global.share_pairs = [];

const fs = require('fs');
const path = require('path');
const md5 = require('md5');
const zip = new require('node-zip')();
const unzip = new require('unzip');
const os = require('os');
const watch = require('node-watch');
const node_machine_id = require('node-machine-id');
const local_client = require('./local_client');
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
            var files = ['local_data/instructions.json', 'local_data/invitations.json', 'local_data/machine.json', 'local_data/sharelist.json', 'local_data/stored_suppress.json'];
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
        var configs = JSON.parse(fs.readFileSync('config.json', 'utf8'));

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

    var configs = JSON.parse(fs.readFileSync('config.json', 'utf8'));
    server_ip = configs.server_ip;
    server_default_port = configs.server_default_port;

    checkForMachineId();

    setInterval(function() {

        var instructions = JSON.parse(fs.readFileSync('local_data/instructions.json', 'utf8'));

        if ( !global.instructionsBeingProcessed ) {
            sendInstructionsToPairs(0, instructions);
        }

    }, 120000);

});

//-------------------------------------------------------------------

function startSharesProcessing() {

    // Get list of shares
    var share_list = JSON.parse(fs.readFileSync("local_data/sharelist.json", "utf8"));

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
                    sharesProcessingContinuation(oldest_filename, sharelist_obj, dates.length);
                }));

            console.log("Starting connection to server!");
            local_client.startConnectionToServer(server_ip, server_default_port);

        }

    });

}

function sharesProcessingContinuation(oldest_filename, sharelist_obj, files_length) {

    var oldest_structure = JSON.parse(fs.readFileSync('local_data/shares/'+oldest_filename, 'utf8'));
        
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
    var oldInstructions = JSON.parse(fs.readFileSync('local_data/instructions.json', 'utf8'));
    var newInstructions = pearlsync_tools.compareStructures(oldest_structure, current_structure, [], 'local', global.machineInfo.id, sharelist_obj.path, sharelist_obj.hash);

    // Starts to watch files for modifications
    watcher[sharelist_obj.hash] = watch(sharelist_obj.path, {recursive: true});
    watcher[sharelist_obj.hash].on('change', function(evt, name) {
        
        if ( name != ".DS_Store" ) {

            var op = "";
            if ( evt === "update" ) {
                op = "add";
            } else if ( evt === "remove" ) {
                op = "remove";
            }

            var suppress = false;
            // Checks if the file is inside the receiving list
            for (var i = 0; i < global.watch_suppress_list.length; i++) {
                if ( name === sharelist_obj.path+global.watch_suppress_list[i] ) {
                    global.watch_suppress_list.splice(i, 1);
                    suppress = true;
                    break;
                }
            }

            if ( !suppress ) {

                var obj = {'op': op, 'path': name.replace(sharelist_obj.path, ''), 'shareid': harelist_obj.hash};

                if ( op === "add" ) {

                    var stats = fs.lstatSync(name);

                    var type = "";
                    if ( stats.isDirectory() ) {
                        type = "folder";
                    } else {
                        type = "file";
                    }

                    obj.type = type;
                    obj.file_timestamp = stats.mtimeMs;

                }

                oldInstructions.push(obj);

                // Update instructions file
                fs.writeFile("local_data/instructions.json", JSON.stringify(oldInstructions), function(err) {
                    if (err) {
                        return console.log(err);
                    } else {
                        if ( !global.instructionsBeingProcessed ) {
                            global.instructionsBeingProcessed = true;
                            setTimeout(function() {
                                sendInstructionsToPairs(0, oldInstructions);
                            }, 10000);
                        }
                    }
                });

            }

            // Write instruction on stored_suppress
            var stored_suppress = JSON.parse(fs.readFileSync('local_data/stored_suppress.json', 'utf8'));
            for (var i = 0; i < stored_suppress.length; i++) {
                var exists = false;
                if ( stored_suppress[i].op === op && stored_suppress[i].path === path ) {
                    exists = true;
                    break;
                }
            }

            if ( !exists ) {
                stored_suppress.push({'op': op, 'path': name});
            }

            fs.writeFileSync('local_data/stored_suppress.json', JSON.stringify(stored_suppress), 'utf8');

        }

    });

    // Check if there are similar instructions already pending
    for (var i = 0; i < newInstructions.length; i++) {

        var exists = false;

        for (var j = 0; j < oldInstructions.length; j++) {
            if ( newInstructions[i].op === oldInstructions[j].op || newInstructions[i].path === oldInstructions[j].path ) {
                exists = true;
            }
        }

        if ( !exists ) {
            oldInstructions.push(newInstructions[i]);
        }

    }
    newInstructions = null;

    // Save updated instructions set
    fs.writeFile("local_data/instructions.json", JSON.stringify(oldInstructions), function(err) {
        if (err) {
            return console.log(err);
        } else {
            if ( !global.instructionsBeingProcessed ) {
                global.instructionsBeingProcessed = true;
                setTimeout(function() {
                    sendInstructionsToPairs(0, oldInstructions);
                }, 10000);
            }
        }
    });

    if ( files_length >= 1 ) {

        // When processing is done, delete oldest share structure
        fs.unlink('local_data/shares/'+oldest_filename+".zip", (err) => {
            if (err) {
                throw err;
            } else {
                console.log('local_data/shares/'+oldest_filename+'.zip was deleted');
            }
        });

    }

    // Clean stored_suppress.json
    fs.writeFileSync('local_data/stored_suppress.json', "[]", 'utf8');

}

function checkForMachineId() {
    
    var machinIdFilePath = 'local_data/machine.json';
    if (fs.existsSync(machinIdFilePath)) {
        
        global.machineInfo = JSON.parse(fs.readFileSync(machinIdFilePath, 'utf8'));
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
        "@IOT@"+
        JSON.stringify({
            'op': 'postNewShare',
            'hash': hash,
            'machineid': global.machineInfo.id,
            'hostname': global.machineInfo.hostname,
            'path': path,
            'local_ip': global.machineInfo.local_ip
        })+
        "@EOT@");

});

ipcMain.on('importNewShare', (event, data) => {
    
    var data = JSON.parse(data);

    // ------- Register new share on server share list --------------
    global.client['server'].write(
        "@IOT@"+
        JSON.stringify({
            'op': 'importNewShare',
            'invitation_hash': data.invitation_hash,
            'machineid': global.machineInfo.id,
            "hostname": global.machineInfo.hostname,
            "path": data.folderpath,
            'hostname': global.machineInfo.hostname,
            'local_ip': global.machineInfo.local_ip
        })+
        "@EOT@");

});

function tryPunchConnection(data, punchConf) {

    punch_time = 0;

    global.client['server'].write(
        "@IOT@"+
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
        })+
        "@EOT@");

};

function processFolderStructure(path, hash) {
                
    var ldate = (new Date()).getTime();

    var folderStructure = [dirTree(path, path)];
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
        pearlsync_tools.executeGetShareList(JSON.parse(fs.readFileSync('local_data/sharelist.json', 'utf8')));
    
    }

}

function getInvitationsList() {

    createFileIfNotExists('local_data/invitations.json', '[]');
    createFileIfNotExists('local_data/sharelist.json', '[]');

    var retObj = {"invitations": JSON.parse(fs.readFileSync('local_data/invitations.json', 'utf8')), "shares": JSON.parse(fs.readFileSync('local_data/sharelist.json', 'utf8'))};
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
        "@IOT@"+
        JSON.stringify({
            'op': 'saveShareInvitation',
            'id': id_hash,
            'share_hash': variable,
            'machineid': global.machineInfo.id,
            'hostname': global.machineInfo.hostname,
            'local_ip': global.machineInfo.local_ip
        })+
        "@EOT@");
});

function dirTree(filename, original_path) {

    var stats = fs.lstatSync(filename);
    if ( filename.indexOf(".DS_Store") === -1 ) {

        var info = {path: filename.replace(original_path, ''), name: path.basename(filename)};

        if (stats.isDirectory()) {
            info.type = "folder";
            info.children = fs.readdirSync(filename).map(function(child) {
                return dirTree(filename+'/'+child, original_path);
            });
        } else {
            // Assuming it's a file. In real life it could be a symlink or
            // something else!
            info.type = "file";
            info.last_modification = stats.mtimeMs;
        }

        return info;

    }

}

function sendInstructionsToPairs(counter, instructions) {

    global.instructionsBeingProcessed = true;

    //for (var i = 0; i < instructions.length; i++) {
    if ( counter < instructions.length ) {

        // Search for credentials on connectionsConfs
        var address_key = "";
        for (var j = 0; j < global.connectionsConfs.length; j++) {
            if ( instructions[counter].machineid === connectionsConfs[j].machineid ) {
                address_key = global.connectionsConfs[j].ip+":"+global.connectionsConfs[j].port;
                break;
            }
        }

        if ( address_key !== "" && global.client[address_key] != null ) {

            var now = (new Date()).getTime();

            if ( instructions[counter].op === 'get' ) {

                global.client[address_key].write(
                    "@IOT@"+JSON.stringify({'op': 'getFile', 'machineid': global.machineInfo.id, 'filename': instructions[counter].path, 'hash': instructions[counter].shareid, 'time': now, 'file_timestamp': instructions[counter].file_timestamp})+"@EOT@");

            } else if ( instructions[counter].op === 'send' ) {

                // Get relative path
                var relative_path = "";
                var share_list = JSON.parse(fs.readFileSync("local_data/sharelist.json", "utf8"));
                for (var j = 0; j < share_list.length; j++) {
                    if ( share_list[j].hash === instructions[counter].shareid ) {
                        relative_path = share_list[j].path;
                        break;
                    }
                }

                // Open file to send
                global.base64[address_key] = (fs.readFileSync(relative_path+instructions[counter].path)).toString('base64');

                var len = global.base64[address_key].length;
                var numbOfFiles = Math.ceil(len/global.transaction_syze);

                var now = (new Date()).getTime();

                global.sending_data = true;
                local_client.sendFileToServer(0, numbOfFiles, instructions[counter].path, instructions[counter].shareid, now, address_key, len, instructions[counter].file_timestamp);

            } else if ( instructions[counter].op === 'add') {

                // Process the add and transforms to send
                for (var i = 0; i < global.share_pairs[i].length; i++) {
                    if ( global.share_pairs[i].hash === instructions[counter].shareid ) {
                        var clients = global.share_pairs[i].clients;
                        for (var j = 0; j < clients.length; j++) {
                            instructions.push({'op': 'send', 'path': instructions[counter].path, 'type': instructions[counter].type, 'machineid': clients[j].machineid, 'shareid': instructions[counter].shareid, 'file_timestamp': instructions[counter].file_timestamp});
                        }
                        break;
                    }
                }
                instructions.splice(counter, 1);

                fs.writeFileSync('local_data/instructions.json', JSON.stringify(instructions), 'utf8');
                
            } else if ( instructions[counter].op === 'remove') {

                // Process the remove operation
                if ( typeof instructions[counter].machineid == "undefined" || instructions[counter].machineid == null ) {

                    // Process the add and transforms to send
                    for (var i = 0; i < global.share_pairs[i].length; i++) {
                        if ( global.share_pairs[i].hash === instructions[counter].shareid ) {
                            var clients = global.share_pairs[i].clients;
                            for (var j = 0; j < clients.length; j++) {
                                instructions.push({'op': 'remove', 'path': instructions[counter].path, 'machineid': clients[j].machineid, 'shareid': instructions[counter].shareid});
                            }
                            break;
                        }
                    }
                    instructions.splice(counter, 1);

                    fs.writeFileSync('local_data/instructions.json', JSON.stringify(instructions), 'utf8');

                }

            }

        }

        var try_ = setInterval(function () {
            if ( !global.sending_data ) {
                clearInterval(try_);
                sendInstructionsToPairs((counter+1), instructions);
            }
        }, 100);
        
    }

    global.instructionsBeingProcessed = false;

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