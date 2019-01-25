const fs = require('fs');
var utimes = require('@ronomon/utimes');

module.exports = {

    returnGetSharePairs: function (data) {
    
        var sharelist = this.getLocalShareList();
    
        for (var i = 0; i < sharelist.length; i++) {
    
            for (var j = 0; j < data.data.length; j++) {
    
                if ( data.data[j].hash === sharelist[i].hash ) {
    
                    data.data[j].path = sharelist[i].path;
    
                    var clients_from_share = data.data[j].clients;
                    var connection_exists = false;

                    for (var k = 0; k < clients_from_share.length; k++) {

                        if ( clients_from_share[k].machineid !== global.machineInfo.id ) {

                            for (var l = 0; l < global.connectionsConfs.length; l++) {
                                if ( global.connectionsConfs[l].machineid === clients_from_share[k].machineid ) {
                                    connection_exists = true;
                                    global.connectionsConfs[l].shares.push(sharelist[i].hash);
                                }
                            }

                            if ( !connection_exists ) {
                                global.connectionsConfs.push({"machineid": clients_from_share[k].machineid, "hostname": clients_from_share[k].hostname, "shares": [sharelist[i].hash]});
                            }

                        }

                    }
                    
                    break;
    
                }
    
            }
    
        }
    
        // Discover IPs for all global.connectionsConfs clients
        var machinesids_list = [];
        for (var i = 0; i < global.connectionsConfs.length; i++) {
            machinesids_list.push({"machineid": global.connectionsConfs[i].machineid});
        }
        console.log("Making request for getPunchDetailsFromIDsList...");
        global.client['server'].write(
            "@IOT@"+
            JSON.stringify({
                "op": "getPunchDetailsFromIDsList",
                "list": machinesids_list,
                'machineid': global.machineInfo.id,
                'hostname': global.machineInfo.hostname,
                'local_ip': global.machineInfo.local_ip
            })+
            "@EOT@");
    
        global.mainWindow.webContents.executeJavaScript("loadShareList("+JSON.stringify(data.data)+");");
        
    },

    getLocalShareList: function () {

        this.createFileIfNotExists('local_data/sharelist.json', '[]');
    
        var sharelist = null;
        try {
            sharelist = JSON.parse(fs.readFileSync('local_data/sharelist.json'));
        } catch (Error) {
            sharelist = [];
        }
    
        return sharelist;
    
    },

    createFileIfNotExists: function (path, content) {
        if ( !fs.existsSync(path) ) {
            fs.writeFileSync(path, content);
        }
    },

    executeGetShareList: function (data) {

        var post_data = {'op': 'getSharePairs', 'data': data, 'machineid': global.machineInfo.id, 'hostname': global.machineInfo.hostname, 'local_ip': global.machineInfo.local_ip};
        if ( global.client['server'].readyState !== "closed" ) {
            global.client['server'].write("@IOT@"+JSON.stringify(post_data)+"@EOT@");
        } else {
            setTimeout(function () {
                this.executeGetShareList(data);
            }, 10000);
        }
    
    },

    compareStructures: function (oldOrRemoteStructure, currentOrLocalStructure, instructions, type, machineid, relative_path, shareid) {

        console.log("oldOrRemoteStructure => "+JSON.stringify(oldOrRemoteStructure));
        console.log("currentOrLocalStructure => "+JSON.stringify(currentOrLocalStructure));

        for (var i = 0; i < oldOrRemoteStructure.length; i++) {
 
            if ( oldOrRemoteStructure[i] != null ) {
                if ( oldOrRemoteStructure[i].path.indexOf(".DS_Store") === -1 ) {

                    var removed = true;
                    var changed = false;
                    var sendOrReceive = 0; // 1 == Send / 2 == Get
                    var file_timestamp = 0;
                    for (var j = 0; j < currentOrLocalStructure.length; j++) {
                        if ( currentOrLocalStructure[j] != null ) {
                            if ( oldOrRemoteStructure[i].path === currentOrLocalStructure[j].path && oldOrRemoteStructure[i].type === currentOrLocalStructure[j].type ) {
                                removed = false;
                                if ( oldOrRemoteStructure[i].type === 'folder' ) {
                                    this.compareStructures(oldOrRemoteStructure[i].children, currentOrLocalStructure[j].children, instructions, type, machineid, relative_path, shareid);
                                } else if ( oldOrRemoteStructure[i].type === 'file' ) {
                                    if ( oldOrRemoteStructure[i].last_modification !== currentOrLocalStructure[j].last_modification ) {
                                        changed = true;
                                        if ( currentOrLocalStructure[j].last_modification > oldOrRemoteStructure[i].last_modification ) {
                                            sendOrReceive = 2; // Get
                                            file_timestamp = currentOrLocalStructure[j].last_modification;
                                        } else {
                                            sendOrReceive = 1; // Send
                                            file_timestamp = oldOrRemoteStructure[i].last_modification;
                                        }
                                    }
                                }
                                break;
                            }
                        }
                    }

                    var path = oldOrRemoteStructure[i].path.replace(relative_path, '');
            
                    if ( removed ) {
                        if ( type == 'local' ) {
                            instructions.push({'op': 'remove', 'path': path, 'execution': 0, 'type': oldOrRemoteStructure[i].type, 'shareid': shareid});
                        } else if ( type == 'remote' ) {
                            console.log("timestamp to return 1) "+oldOrRemoteStructure[i].last_modification);
                            instructions.push({'op': 'send', 'path': path, 'execution': 0, 'type': oldOrRemoteStructure[i].type, 'machineid': machineid, 'shareid': shareid, 'file_timestamp': oldOrRemoteStructure[i].last_modification});
                        }
                    } else if ( changed ) {
                        if ( type == 'local' ) {
                            console.log("timestamp to return 2) "+file_timestamp);
                            instructions.push({'op': 'add', 'path': path, 'execution': 0, 'type': oldOrRemoteStructure[i].type, 'shareid': shareid, 'file_timestamp': file_timestamp});
                        } else if ( type == 'remote' ) {
                            if ( sendOrReceive == 1 ) {
                                console.log("timestamp to return 3) "+file_timestamp);
                                instructions.push({'op': 'send', 'path': path, 'execution': 0, 'type': oldOrRemoteStructure[i].type, 'machineid': machineid, 'shareid': shareid, 'file_timestamp': file_timestamp});
                            } else if ( sendOrReceive == 2 ) {
                                console.log("timestamp to return 4) "+file_timestamp);
                                instructions.push({'op': 'get', 'path': path, 'execution': 0, 'type': oldOrRemoteStructure[i].type, 'machineid': machineid, 'shareid': shareid, 'file_timestamp': file_timestamp});
                            }
                        }
                    }

                }
            }
            
        }
    
        for (var i = 0; i < currentOrLocalStructure.length; i++) {

            if ( currentOrLocalStructure[i] != null ) {

                if ( currentOrLocalStructure[i].path.indexOf(".DS_Store") === -1 ) {

                    var added = true;
                    for (var j = 0; j < oldOrRemoteStructure.length; j++) {
                        if ( oldOrRemoteStructure[j] != null ) {
                            if ( oldOrRemoteStructure[j].path === currentOrLocalStructure[i].path && oldOrRemoteStructure[j].type === currentOrLocalStructure[i].type ) {
                                added = false;
                                break;
                            }
                        }
                    }
            
                    if ( added ) {
    
                        console.log("currentOrLocalStructure["+i+"].path: "+currentOrLocalStructure[i].path+", relative_path: "+relative_path);
                        var path = currentOrLocalStructure[i].path.replace(relative_path, '');
    
                        if ( type == 'local' ) {
                            instructions.push({'op': 'add', 'path': path, 'execution': 0, 'type': currentOrLocalStructure[i].type, 'shareid': shareid, 'file_timestamp': currentOrLocalStructure[i].last_modification});
                        } else if ( type == 'remote' ) {
                            console.log("timestamp to return 5) "+currentOrLocalStructure[i].file_timestamp);
                            instructions.push({'op': 'get', 'path': path, 'execution': 0, 'type': currentOrLocalStructure[i].type, 'machineid': machineid, 'shareid': shareid, 'file_timestamp': currentOrLocalStructure[i].last_modification});
                        }

                    }
    
                }

            }

        }
    
        return instructions;
    
    },

    checkReceivedFileSync: function () {

        var complete = false;

        for (var i = 0; i < global.received_files.length; i++) {
    
            var numbOfFiles = global.received_files[i].numbOfFiles;
    
            var counter = 0;
    
            // Check if file is complete
            for (var j = 0; j < global.received_files.length; j++) {
                if ( global.received_files[i].filename === global.received_files[j].filename && global.received_files[i].time === global.received_files[j].time ) {
                    counter++;
                }
            }
    
            console.log("counter: "+counter+", numbOfFiles: "+numbOfFiles);
            if ( counter === numbOfFiles ) {

                complete = true;
    
                // The file is complete
                var fileOnBase64 = [];
                
                for (var j = 0; j < global.received_files.length; j++) {
                    if ( global.received_files[i].filename === global.received_files[j].filename && global.received_files[i].time === global.received_files[j].time ) {
                        fileOnBase64[global.received_files[i].counter] = global.received_files[i].base64part;
                    }
                }
    
                // Mount string
                var completeBase64 = "";
                for (var j = 0; j < numbOfFiles; j++) {
                    completeBase64 = completeBase64 + fileOnBase64[j];
                }
    
                // Convert from string to file
                if ( global.received_files[i].op === 'sendSyncroReportFile' ) {
                    
                    console.log("global.received_files["+i+"].filename: "+global.received_files[i].filename);
                    fs.writeFileSync(global.received_files[i].filename, completeBase64, {encoding: 'base64'});
                
                } else if ( global.received_files[i].op === 'sendFile' || global.received_files[i].op === 'returnGetFile' ) {
    
                    var relative_path = "";

                    var share_list = JSON.parse(fs.readFileSync('local_data/sharelist.json', 'utf8'));
                    for (var j = 0; j < share_list.length; j++) {
                        if ( share_list[j].hash === global.received_files[i].hash ) {
                            relative_path = share_list[j].path;
                            break;
                        }
                    }
                    global.watch_suppress_list.push(global.received_files[i].filename);

                    fs.writeFileSync(relative_path+global.received_files[i].filename, completeBase64, {encoding: 'base64'});
                    console.log('File successfully writen on '+relative_path+global.received_files[i].filename);

                    var time = global.received_files[i].file_timestamp;
                    utimes.utimes(relative_path+global.received_files[i].filename, time, time, time, function () {
                        console.log('Alterada a data de '+time);
                    });
    
                }
                
                // Remove instruction
                var instructions = JSON.parse(fs.readFileSync('local_data/instructions.json', 'utf8'));
                for (var j = 0; j < instructions.length; j++) {
                    if ( instructions[j].path === global.received_files[i].filename && instructions[j].shareid === global.received_files[i].hash ) {
                        console.log("Removing instruction +> "+JSON.stringify(instructions));
                        instructions.splice(j, 1);
                    }
                }
                fs.writeFileSync('local_data/instructions.json', JSON.stringify(instructions), 'utf8');

                // Remove the content from the file array
                for (var j = 0; j < global.received_files.length; j++) {
                    if ( global.received_files[i].op === global.received_files[j].op && global.received_files[i].filename === global.received_files[j].filename && global.received_files[i].time === global.received_files[j].time ) {
                        global.received_files.splice(j, 1);
                    }
                }
                
            }
    
        }

        return complete;

    }

}