const fs = require('fs');
const path = require('path');
const md5 = require('md5');
const zip = new require('node-zip')();
const unzip = new require('unzip');
const os = require('os');
const net = require('net');
const watch = require('node-watch');
const node_machine_id = require('node-machine-id');

var machineInfo = null;
var debug_browser = false;

var punch_time = 0;

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

        createFileIfNotExists('config.json', "{}");
        var configs = JSON.parse(fs.readFileSync('config.json', 'utf-8'));

        configs.server_ip = server_ip;
        configs.server_default_port = server_port;

        fs.writeFileSync('config.json', JSON.stringify(configs));

    }

}
processArgs(process.argv+'');

var connectionsConfs = [];

var client = [];
client['server'] = new net.Socket();

var socket = [];
var server = net.createServer(function (socket_) {
    
    var remote_address = socket_.remoteAddress.replace("::ffff:", "")+":"+socket_.remotePort;
    console.log("Stablishing connection with "+remote_address+"\n");

	socket[remote_address] = socket_;
    Connects(remote_address);
    
});

function Connects (address) {

	socket[address].on('data', function (data) {

		console.log("received data => "+data+"\n");

        data = JSON.parse(data);

        var confExists = false;
        var i = 0;
        for (i = 0; i < connectionsConfs.length; i++) {
            if ( connectionsConfs[i].machineid === data.data.machineid ) {
                confExists = true;
                break;
            }
        }

        if ( !confExists ) {
            socket[address] = null;
        } else {

            if ( data.op === 'handShake' ) {

                connectionsConfs[i].machineid = data.data.machineid;
                connectionsConfs[i].ip = socket[address].remoteAddress;
                connectionsConfs[i].port = socket[address].remotePort;
                connectionsConfs[i].type = "server";
                connectionsConfs[i].pingtime = (new Date()).getTime();
                connectionsConfs[i].status = "connected";

                mainWindow.webContents.executeJavaScript("loadConnectionsList("+JSON.stringify(connectionsConfs)+");");
            
            }

        }

    });

	socket[address].on('end', function () {
	    console.log('> ('+socket[address].remoteAddress+':'+socket[address].remotePort+') connection closed.\n');
	    socket[address] = null;
	});

	socket[address].on('error', function (err) {
	    console.log('> ('+socket[address].remoteAddress+':'+socket[address].remotePort+') connection closed with err (',err,').\n');
	    socket[address] = null;
    });
    
}

server.listen(9999, function (err) {
	if (err) {
        return console.log(err+"\n");
    }
	console.log('server listening on', server.address().address + ':' + server.address().port+"\n");
});

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

    if ( debug_browser ) {
        // Open the devtools.
        mainWindow.openDevTools();
    }
    
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

        console.log('Connected to server '+server_ip+":"+server_default_port);

    });    

    client['server'].on('end', function () {
        // Try to reestablish connection
        client['server'] = new net.Socket();
        var reconnection = setInterval(function () {
            client['server'].connect(server_default_port, server_ip, function() {
                console.log('Connected to server '+server_ip+":"+server_default_port);
                clearInterval(reconnection);
            });
        }, 10000);
    });
    
    client['server'].on('error', function (err) {
        // Try to reestablish connection
        console.log("Error while connecting ==> "+err);
        client['server'] = new net.Socket();
        var reconnection = setInterval(function () {
            client['server'].connect(server_default_port, server_ip, function() {
                console.log('Connected to server '+server_ip+":"+server_default_port);
                clearInterval(reconnection);
            });
        }, 10000);
    });
    
    client['server'].on('uncaughtException', function (err) {
        console.log("[uncaughtException] Error while connecting ==> "+err);
    });

    setTimeout(checkForMachineId, 1000);
    setTimeout(startSharesProcessing, 2000);

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
    createFileIfNotExists('local_data/instructions.json', '[]');
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
        
        machineInfo = JSON.parse(fs.readFileSync(machinIdFilePath, 'utf-8'));
        console.group("Readed machine id: "+machineInfo.id);

        if ( typeof machineInfo.id === 'undefined' ) {
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

            machineInfo.local_ip = addresses;
            console.log("The local IP Addresses are "+JSON.stringify(machineInfo.local_ip));

            checkForConfiguredShares();

        }

    } else {

        console.log("No machine id found (1)");
        createNewMachineId();
        
    }

}

function createNewMachineId() {

    //console.log("Creating a new one");
    machineInfo = {"id": node_machine_id.machineIdSync(), "hostname": os.hostname()};
    //console.log("machineInfo.id: "+machineInfo.id);

    fs.writeFileSync("local_data/machine.json", JSON.stringify(machineInfo));
    checkForConfiguredShares();

}

function checkForConfiguredShares() {
    fs.readdir('local_data/shares/', (err, local_shares_files) => {
        if ( local_shares_files.length == 0 ) {
            //console.log("No pair found");
            mainWindow.webContents.executeJavaScript("callModalAddNewShare();");
        }
    });
}

ipcMain.on('createNewShare', (event, path) => {
    
    var now = new Date().getTime;
    var hash = md5(path+now);

    // ------- Register new share on server share list --------------
    client['server'].write(
        JSON.stringify({
            'op': 'postNewShare',
            'hash': hash,
            'machineid': machineInfo.id,
            'hostname': machineInfo.hostname,
            'path': path,
            'local_ip': machineInfo.local_ip
        }));

});

ipcMain.on('importNewShare', (event, data) => {
    
    var data = JSON.parse(data);

    // ------- Register new share on server share list --------------
    client['server'].write(
        JSON.stringify({
            'op': 'importNewShare',
            'invitation_hash': data.invitation_hash,
            'machineid': machineInfo.id,
            "hostname": machineInfo.hostname,
            "path": data.folderpath,
            'hostname': machineInfo.hostname,
            'local_ip': machineInfo.local_ip
        }));

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

            processFolderStructure(data.path, data.hash);

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

    } else if ( data.op === 'returnGetPunchConfigFromIP' ) {

        for (var i = 0; i < connectionsConfs.length; i++) {
            if ( connectionsConfs[i].machineid === data.machineid ) {
                connectionsConfs[i].pingtime = data.pingtime;
                connectionsConfs[i].ip = data.ip;
                connectionsConfs[i].port = data.port; 
                mainWindow.webContents.executeJavaScript("loadConnectionsList("+JSON.stringify(connectionsConfs)+");");
                break;
            }
        }

    } else if ( data.op === 'returnGetPunchDetailsFromIDsList' ) {

        var punchConfs = data.data;
        for (var i = 0; i < connectionsConfs.length; i++) {
            for (var j = 0; j < punchConfs.length; j++) {
                if ( connectionsConfs[i].machineid === punchConfs[j].machineid ) {
                    
                    connectionsConfs[i].ip = punchConfs[j].ip;
                    connectionsConfs[i].port = punchConfs[j].port;
                    connectionsConfs[i].status = punchConfs[j].status;
                    connectionsConfs[i].local_ip = punchConfs[j].local_ip;

                    var origin_address = connectionsConfs[i].ip+":"+connectionsConfs[i].port;
                    
                    if ( punchConfs[j].status === "disconnected" ) {
                    
                        connectionsConfs[i].type = "server";
                    
                    } else  if ( punchConfs[j].status === "ready_for_connection" ) {
                        
                        connectionsConfs[i].type = "client";

                        // First try to connect localy
                        console.log("connectionsConfs[i].local_ip ==> "+(typeof connectionsConfs[i].local_ip));
                        console.log("connectionsConfs[i].local_ip.length ==> "+connectionsConfs[i].local_ip.length);

                        if ( typeof connectionsConfs[i].local_ip != "undefined" && connectionsConfs[i].local_ip.length > 0 ) {
                            console.log("Will try local connection method...");
                            tryLocalConnection(connectionsConfs[i], origin_address, punchConfs[j], data, 0);    
                        } else {
                            // Or if no local IPs for remote machine, try hole punching method
                            console.log("Going directly do hole punching method...");
                            tryPunchConnection(data, punchConfs[j]);
                        }
                        
                    }
                    
                    break;
                
                }
            }
        }

        mainWindow.webContents.executeJavaScript("loadConnectionsList("+JSON.stringify(connectionsConfs)+");");

    } else if ( data.op === 'forwardPunchRequest' ) {

        var origin_address = data.data.punchOriginIP+":"+data.data.punchOriginPort;
        console.log('Trying to connect to client '+origin_address+', hole punch should fail.');
        client[origin_address] = net.createConnection({host : data.data.punchOriginIP, port : data.data.punchOriginPort}, function() {

        });

        client[origin_address].on('error', function (err) {
            console.log("Failed to connect to orgin address "+origin_address+". It was expected. The server will be notified and forward this information to the origin.");
            client['server'].write(
                JSON.stringify({
                    'op': 'returnForwardPunchRequest',
                    'data': data.data,
                    'machineid': machineInfo.id,
                    "hostname": machineInfo.hostname,
                    'local_ip': machineInfo.local_ip
                }));
        });

    } else if ( data.op === 'returnSendPunchRequest' ) {

        var destiny_address = data.data.punchDestinyIP+":"+data.data.punchDestinyPort;
        client[destiny_address] = new net.Socket();

        console.log("Trying to stablish final punch connection to "+destiny_address);
        client[destiny_address].connect(data.data.punchDestinyPort, data.data.punchDestinyIP, function() {

            client[destiny_address].setTimeout(0);
            punch_time = 0;

            console.log('Hole punching to '+origin_address+' successfully stablished!!!');
            console.log("Sending hand shake...");
            client[destiny_address].write(JSON.stringify({'op': 'handShake', 'data': data.data}));

        });

        // Try to hole punch for 30 seconds
        var now = (new Date()).getTime();
        if ( (now-punch_time) < 30000 ) {

            client[destiny_address].setTimeout(10, function () {
                // Make a retry for connection
                console.log("Retry connection");
                client['server'].write(
                    JSON.stringify({
                        'op': 'sendPunchRequest',
                        'machineid': machineInfo.id,
                        'hostname': machineInfo.hostname,
                        'data': data.data,
                        'local_ip': machineInfo.local_ip
                    }));
            });

        } else {

            client[destiny_address].setTimeout(0);
            punch_time = 0;

            console.log("Tried hole punching for 30 seconds and failed. Will try TURN approach.");

        }

    }

});

function tryLocalConnection(connectionConf, origin_address, punchConf, data, counter) {

    console.log("Trying to stablish connection with local approach for "+connectionConf.local_ip[counter]+":9999");
    client[origin_address] = net.createConnection({host : connectionConf.local_ip[counter], port : 9999}, function() {
        
        client[origin_address].setTimeout(0);
        console.log("Local connection successfully stablished to "+origin_address+"!");
        console.log("Sending hand shake...");
        client[origin_address].write(JSON.stringify({'op': 'handShake', 'data': data}));
        
    });

    client[origin_address].setTimeout(5000, function () {
        client[origin_address].setTimeout(0);
        if ( counter < connectionConf.local_ip.length ) {
            counter++;
            tryLocalConnection(connectionConf, origin_address, punchConf, data, counter);
        } else {
            // If local connection could not be stablished within 10 seconds, try the hole punch approach
            tryPunchConnection(data, punchConf);
        }
    });

    client[origin_address].on('error', function (error) {
        client[origin_address].setTimeout(0);
        if ( counter < connectionConf.local_ip.length ) {
            counter++;
            tryLocalConnection(connectionConf, origin_address, punchConf, data, counter);
        } else {
            // If local connection could not be stablished within 10 seconds, try the hole punch approach
            tryPunchConnection(data, punchConf);
        }
    });

}

function tryPunchConnection(data, punchConf) {

    punch_time = 0;

    client['server'].write(
        JSON.stringify({
            'op': 'sendPunchRequest',
            'machineid': machineInfo.id,
            'hostname': machineInfo.hostname,
            'data': {
                'punchOriginIP': data.originip,
                'punchOriginPort': data.originport,
                'punchDestinyIP': punchConf,
                'punchDestinyPort': punchConf
            },
            'local_ip': machineInfo.local_ip
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

function createFileIfNotExists(path, content) {
    if ( !fs.existsSync(path) ) {
        fs.writeFileSync(path, content);
    }
}

function returnGetSharePairs(data) {

    connectionsConfs = [];

    var sharelist = getLocalShareList();

    for (var i = 0; i < sharelist.length; i++) {

        console.log("processing returnGetSharePairs ====> sharelist[i].hash: "+sharelist[i].hash);
        
        for (var j = 0; j < data.data.length; j++) {

            if ( data.data[j].hash === sharelist[i].hash ) {

                data.data[j].path = sharelist[i].path;

                var clients_from_share = data.data[j].clients;
                var connection_exists = false;
                for (var k = 0; k < clients_from_share.length; k++) {
                    if ( clients_from_share[k].machineid !== machineInfo.id ) {
                        for (var j = 0; j < connectionsConfs.length; j++) {
                            if ( connectionsConfs[j].machineid === clients_from_share[k].machineid ) {
                                connection_exists = true;
                                break;
                            }
                        }
                        if ( !connection_exists ) {
                            connectionsConfs.push({"machineid": clients_from_share[k].machineid, "hostname": clients_from_share[k].hostname});
                        }
                    }
                }
                
                break;

            }

        }

    }

    // Discover IPs for all connectionsConfs clients
    var machinesids_list = [];
    for (var i = 0; i < connectionsConfs.length; i++) {
        machinesids_list.push({"machineid": connectionsConfs[i].machineid});
    }
    console.log("Making request for getPunchDetailsFromIDsList...");
    client['server'].write(
        JSON.stringify({
            "op": "getPunchDetailsFromIDsList",
            "list": machinesids_list,
            'machineid': machineInfo.id,
            'hostname': machineInfo.hostname,
            'local_ip': machineInfo.local_ip
        }));

    mainWindow.webContents.executeJavaScript("loadShareList("+JSON.stringify(data.data)+");");
    
}

function getShareList() {

    if ( machineInfo == null ) {

        console.log("machineInfo == null");
        setTimeout(getShareList, 1000);

    } else {

        createFileIfNotExists('local_data/sharelist.json', '[]');

        var data = JSON.parse(fs.readFileSync('local_data/sharelist.json', 'utf-8'));

        // Build the post string from an object
        executeGetShareList(machineInfo.id, data);
    
    }

}

function executeGetShareList(id, data) {

    var post_data = {'op': 'getSharePairs', 'data': data, 'machineid': machineInfo.id, 'hostname': machineInfo.hostname, 'local_ip': machineInfo.local_ip};
    if ( client['server'].readyState !== "closed" ) {
        client['server'].write(JSON.stringify(post_data));
    } else {
        setTimeout(function () {
            executeGetShareList(id, data);
        }, 10000);
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
    client['server'].write(
        JSON.stringify({
            'op': 'saveShareInvitation',
            'id': id_hash,
            'share_hash': variable,
            'machineid': machineInfo.id,
            'hostname': machineInfo.hostname,
            'local_ip': machineInfo.local_ip
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