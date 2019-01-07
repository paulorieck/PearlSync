const fs = require('fs');
const path = require('path');
const md5 = require('md5');
const zip = new require('node-zip')();
const os = require('os');
const net = require('net');

var client = [];
client['server'] = new net.Socket();

const {app, BrowserWindow, ipcMain} = require('electron');

var machineInfo = null;

// Report crashes to our server.
//require('crash-reporter').start();

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is GCed.
var mainWindow = null;

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
    mainWindow = new BrowserWindow({width: 800, height: 600});
    mainWindow.maximize();

    // and load the index.html of the app.
    mainWindow.loadURL('file://'+__dirname+'/index.html');

    // Open the devtools.
    mainWindow.openDevTools();

    // Emitted when the window is closed.
    mainWindow.on('closed', function() {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null;
    });

    var configs = JSON.parse(fs.readFileSync('config.json', 'utf-8'));
    server_ip = configs.server_ip;
    server_default_port = configs.server_default_port;

    client['server'].connect(server_default_port, server_ip, function() {
        console.log('Connected to server');
    });    

    setTimeout(checkForMachineId, 1000);

});

//-------------------------------------------------------------------

function checkForMachineId() {
    
    var machinIdFilePath = 'local_data/machine.json';
    if (fs.existsSync(machinIdFilePath)) {
        
        machineInfo = JSON.parse(fs.readFileSync(machinIdFilePath, 'utf8'));
        console.group("Readed machine id: "+machineInfo.id);
        checkForConfiguredShares();

    } else {

        console.log("No machine id found");
        createNewMachineId();
        
    }

}

function createNewMachineId() {

    console.log("Creating a new one");
    var machineId = require('node-machine-id').machineIdSync;
    var hostname = os.hostname();
    console.log(machineId);

    machineInfo = {"id": machineId, "hostname": hostname};

    fs.writeFile("local_data/machine.json", JSON.stringify(machineInfo), function(err) {
        if (err) {
            return console.log(err);
        } else {
            checkForConfiguredShares();
        }
    });

}

function checkForConfiguredShares() {
    fs.readdir('local_data/shares/', (err, local_shares_files) => {
        if ( local_shares_files.length == 0 ) {
            console.log("No pair found");
            mainWindow.webContents.executeJavaScript("callModalAddNewShare();");
        }
    });
}

ipcMain.on('createNewShare', (event, path) => {
    
    var now = new Date().getTime;
    var hash = md5(path+now);
    console.log("createNewShare ==> hash: "+hash);

    // ------- Register new share on server share list --------------
    client['server'].write(JSON.stringify({'op': 'postNewShare','hash': hash, 'machineid': machineInfo.id, 'hostname': machineInfo.hostname, 'path': path}));

});

function getLocalShareList() {

    createFileIfNotExists('local_data/sharelist.json', '[]');

    var sharelist = null;
    try {
        sharelist = JSON.parse(fs.readFileSync('local_data/sharelist.json'));
    } catch (Error) {
        sharelist = [];
    }

    return sharelist;

}

client['server'].on('data', function(data) {

    console.log('Received: ' + data);
    data = JSON.parse(data);

    if ( data.op === 'returnSaveNewShare' ) {

        if ( data.result === 'success' ) {

            createFileIfNotExists('local_data/sharelist.json', '[]');

            // ------- Register new share on local share list --------------
            var sharelist = getLocalShareList();

            sharelist.push({'hash': data.hash, 'path': data.path});
            fs.writeFileSync('local_data/sharelist.json', JSON.stringify(sharelist));

            var folderStructure = dirTree(data.path);
            var folderStructureStr = JSON.stringify(folderStructure);

            fs.writeFileSync('local_data/shares/'+data.hash+'.json', folderStructureStr);

            // ----- ZIP FILE -------------------
            zip.file(data.hash+'.json', folderStructureStr);
            var data2 = zip.generate({base64:false,compression:'DEFLATE'});
            fs.writeFileSync('local_data/shares/'+data.hash+'.json.zip', data2, 'binary');

            fs.unlink('local_data/shares/'+data.hash+'.json', (err) => {
                if (err) throw err;
                console.log('local_data/shares/'+data.hash+'.json was deleted');
            });

            // ----- Show refreshed shares div ----------
            getShareList();

        }

    } else if ( data.op === 'returnGetSharePairs' ) {

        returnGetSharePairs(data);

    } else if ( data.op === 'returnShareInvitation' ) {

        createFileIfNotExists('local_data/invitations.json', '[]');

        var invitation = JSON.parse(fs.readFileSync('local_data/invitations.json', 'utf-8'));
        invitation.push({"share_invitation_id": data.share_invitation_id, 'timeout': data.timeout, 'share_hash': data.share_hash});
        fs.writeFile("local_data/invitations.json", JSON.stringify(invitation), function(err) {
            if (err) {
                return console.log(err);
            } else {
                getInvitationsList();
            }
        });

    }

});

function createFileIfNotExists(path, content) {

    if ( !fs.existsSync(path) ) {
        fs.writeFile(path, content, (err) => {
            if (err) {
                throw err;
            }
        }); 
    }

}

function returnGetSharePairs(data) {

    var sharelist = getLocalShareList();

    for (var i = 0; i < sharelist.length; i++) {
        for (var j = 0; j < data.data.length; j++) {
            if ( data.data[j].hash === sharelist[i].hash ) {
                data.data[j].path = sharelist[i].path;
                break;
            }
        }
    }

    var returndataStr = JSON.stringify(data.data);
    console.log('returnGetSharePairs: '+returndataStr);
    mainWindow.webContents.executeJavaScript("loadShareList("+returndataStr+");");

}

function getShareList() {

    if ( machineInfo == null ) {

        console.log("machineInfo == null");
        setTimeout(getShareList, 1000);

    } else {

        createFileIfNotExists('local_data/sharelist.json', '[]');

        var data = JSON.parse(fs.readFileSync('local_data/sharelist.json', 'utf-8'));

        // Build the post string from an object
        var post_data = {'op': 'getSharePairs', 'machineid': machineInfo.id, 'data': data};
        client['server'].write(JSON.stringify(post_data));

    }

}

function getInvitationsList() {

    createFileIfNotExists('local_data/invitations.json', '[]');
    createFileIfNotExists('local_data/sharelist.json', '[]');

    var invitations = JSON.parse(fs.readFileSync('local_data/invitations.json', 'utf-8'));
    var shares = JSON.parse(fs.readFileSync('local_data/sharelist.json', 'utf-8'));
    var retObj = {"invitations": invitations, "shares": shares};
    mainWindow.webContents.executeJavaScript("returnLoadInvitationsList("+JSON.stringify(retObj)+")");

}

ipcMain.on('getInvitationsList', (event, variable) => {
    getInvitationsList();
});

ipcMain.on('getShareList', (event, variable) => {
    getShareList();
});

ipcMain.on('saveShareInvitation', (event, variable) => {
    var id_hash = md5(machineInfo.id+(new Date()).getTime()+variable);
    client['server'].write(JSON.stringify({'op': 'saveShareInvitation', 'id': id_hash, 'share_hash': variable}));
});

function dirTree(filename) {

    var stats = fs.lstatSync(filename),
        info = {
            path: filename,
            name: path.basename(filename)
        };

    if (stats.isDirectory()) {
        info.type = "folder";
        info.children = fs.readdirSync(filename).map(function(child) {
            return dirTree(filename + '/' + child);
        });
    } else {
        // Assuming it's a file. In real life it could be a symlink or
        // something else!
        info.type = "file";
    }

    return info;

}