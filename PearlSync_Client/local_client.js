const net = require('net');
const pearlsync_tools = require('./pearlsync_tools');
const fs = require('fs');

var clientBuffer = [];

module.exports = {

    startConnectionToServer: function (server_ip, server_default_port) {
      
        global.client['server'] = new net.Socket();

        global.client['server'].connect(server_default_port, server_ip, function() {
            console.log('Connected to server '+server_ip+":"+server_default_port);
        });    

        global.client['server'].on('end', function () {
            // Try to reestablish connection
            global.client['server'] = new net.Socket();
            var reconnection = setInterval(function () {
                global.client['server'].connect(server_default_port, server_ip, function() {
                    console.log('Connected to server '+server_ip+":"+server_default_port);
                    clearInterval(reconnection);
                });
            }, 10000);
        });
        
        global.client['server'].on('error', function (err) {
            // Try to reestablish connection
            console.log("Error while connecting ==> "+err);
            global.client['server'] = new net.Socket();
            var reconnection = setInterval(function () {
                global.client['server'].connect(server_default_port, server_ip, function() {
                    console.log('Connected to server '+server_ip+":"+server_default_port);
                    clearInterval(reconnection);
                });
            }, 10000);
        });
        
        global.client['server'].on('uncaughtException', function (err) {
            console.log("[uncaughtException] Error while connecting ==> "+err);
        });

        global.client['server'].on('data', function(data) {

            console.log("rawData: "+data);

            data = data+"";

            var complete = false;
            if ( data.indexOf("@IOT") != -1 && data.indexOf("@EOT@") != -1 ) {
                complete = true;
            } else if ( data.indexOf("@IOT@") != -1 ) {
                clientBuffer['server'] = data;
            } else if ( data.indexOf("@EOT@") != -1  ) {
                complete = true;
                data = clientBuffer['server']+data;
            } else {
                clientBuffer['server'] = clientBuffer['server']+data;
            }

            if ( complete ) {

                data = data.replace('@IOT@', '').replace('@EOT@', '');

                if ( data.length < 1000 ) {
                    console.log('Received: ' + data);
                }
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
                        pearlsync_tools.getShareList();
            
                    }
            
                } else if ( data.op === 'returnGetSharePairs' ) {
            
                    pearlsync_tools.returnGetSharePairs(data);
            
                } else if ( data.op === 'returnShareInvitation' ) {
            
                    pearlsync_tools.createFileIfNotExists('local_data/invitations.json', '[]');
            
                    var invitation = JSON.parse(fs.readFileSync('local_data/invitations.json', 'utf8'));
                    invitation.push({"share_invitation_id": data.share_invitation_id, 'timeout': data.timeout, 'share_hash': data.share_hash});
                    fs.writeFile("local_data/invitations.json", JSON.stringify(invitation), function(err) {
                        if (err) {
                            return console.log(err);
                        } else {
                            getInvitationsList();
                        }
                    });
            
                } else if ( data.op === 'returnGetPunchConfigFromIP' ) {
            
                    for (var i = 0; i < global.connectionsConfs.length; i++) {
                        if ( global.connectionsConfs[i].machineid === data.machineid ) {
                            global.connectionsConfs[i].pingtime = data.pingtime;
                            global.connectionsConfs[i].ip = data.ip;
                            global.connectionsConfs[i].port = data.port; 
                            global.mainWindow.webContents.executeJavaScript("loadConnectionsList("+JSON.stringify(global.connectionsConfs)+");");
                            break;
                        }
                    }
            
                } else if ( data.op === 'returnGetPunchDetailsFromIDsList' ) {
            
                    var punchConfs = data.data;
                    for (var i = 0; i < global.connectionsConfs.length; i++) {
                        for (var j = 0; j < punchConfs.length; j++) {
                            if ( global.connectionsConfs[i].machineid === punchConfs[j].machineid ) {
                                
                                global.connectionsConfs[i].ip = punchConfs[j].ip;
                                global.connectionsConfs[i].port = punchConfs[j].port;
                                global.connectionsConfs[i].status = punchConfs[j].status;
                                global.connectionsConfs[i].local_ip = punchConfs[j].local_ip;
            
                                var origin_address = global.connectionsConfs[i].ip+":"+global.connectionsConfs[i].port;
                                
                                if ( punchConfs[j].status === "disconnected" ) {
                                
                                    global.connectionsConfs[i].type = "server";
                                
                                } else  if ( punchConfs[j].status === "ready_for_connection" ) {
                                    
                                    global.connectionsConfs[i].type = "client";
            
                                    // First try to connect localy
                                    if ( typeof global.connectionsConfs[i].local_ip != "undefined" && global.connectionsConfs[i].local_ip.length > 0 ) {
                                        console.log("Will try local connection method...");
                                        tryLocalConnection(global.connectionsConfs[i], origin_address, punchConfs[j], data, 0);    
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
            
                    global.mainWindow.webContents.executeJavaScript("loadConnectionsList("+JSON.stringify(global.connectionsConfs)+");");
            
                } else if ( data.op === 'forwardPunchRequest' ) {
            
                    var origin_address = data.data.punchOriginIP+":"+data.data.punchOriginPort;
                    console.log('Trying to connect to client '+origin_address+', hole punch should fail.');
                    global.client[origin_address] = net.createConnection({host : data.data.punchOriginIP, port : data.data.punchOriginPort}, function() {
            
                    });
            
                    global.client[origin_address].on('error', function (err) {
                        console.log("Failed to connect to orgin address "+origin_address+". It was expected. The server will be notified and forward this information to the origin.");
                        global.client['server'].write(
                            "@IOT@"+
                            JSON.stringify({
                                'op': 'returnForwardPunchRequest',
                                'data': data.data,
                                'machineid': global.machineInfo.id,
                                "hostname": global.machineInfo.hostname,
                                'local_ip': global.machineInfo.local_ip
                            })+
                            "@EOT@");
                    });
            
                } else if ( data.op === 'returnSendPunchRequest' ) {
            
                    var destiny_address = data.data.punchDestinyIP+":"+data.data.punchDestinyPort;
                    global.client[destiny_address] = new net.Socket();
            
                    console.log("Trying to stablish final punch connection to "+destiny_address);
                    global.client[destiny_address].connect(data.data.punchDestinyPort, data.data.punchDestinyIP, function() {
            
                        global.client[destiny_address].setTimeout(0);
                        punch_time = 0;
            
                        console.log('Hole punching to '+origin_address+' successfully stablished!!!');
                        console.log("Sending hand shake...");
                        global.client[destiny_address].write("@IOT@"+JSON.stringify({'op': 'handShake', 'machineid': global.machineInfo.id})+"@EOT@");
            
                    });
            
                    // Try to hole punch for 30 seconds
                    var now = (new Date()).getTime();
                    if ( (now-punch_time) < 30000 ) {
            
                        global.client[destiny_address].setTimeout(10, function () {
                            // Make a retry for connection
                            console.log("Retry connection");
                            global.client['server'].write(
                                "@IOT@"+
                                JSON.stringify({
                                    'op': 'sendPunchRequest',
                                    'machineid': global.machineInfo.id,
                                    'hostname': global.machineInfo.hostname,
                                    'data': data.data,
                                    'local_ip': global.machineInfo.local_ip
                                })+
                                "@EOT@");
                        });
            
                    } else {
            
                        global.client[destiny_address].setTimeout(0);
                        punch_time = 0;
            
                        console.log("Tried hole punching for 30 seconds and failed. Will try TURN approach.");
            
                    }
            
                }

            }

            
        
        });

    }

};

function tryLocalConnection(connectionConf, origin_address, punchConf, data, counter) {

    var remote_machine_id = "";

    console.log("Trying to stablish connection with local approach for "+connectionConf.local_ip[counter]+":9999");
    global.client[origin_address] = net.createConnection({host : connectionConf.local_ip[counter], port : 9999}, function() {
        
        global.client[origin_address].setTimeout(0);
        console.log("Local connection successfully stablished to "+origin_address+"!");

        global.client[origin_address].on('data', function(data) {

            //console.log("Raw data: [local client] "+data);

            data = data+"";

            var complete = false;
            if ( data.indexOf("@IOT") != -1 && data.indexOf("@EOT@") != -1 ) {
                complete = true;
                clientBuffer[origin_address] = "";
            } else if ( data.indexOf("@IOT@") != -1 ) {
                clientBuffer[origin_address] = data;
            } else if ( data.indexOf("@EOT@") != -1  ) {
                complete = true;
                data = clientBuffer[origin_address]+data;
                clientBuffer[origin_address] = "";
            } else {
                clientBuffer[origin_address] = clientBuffer[origin_address]+data;
            }

            if ( complete ) {

                data = data.replace('@IOT@', '').replace('@EOT@', '');

                console.log('Received: ' + data);
                data = JSON.parse(data);

                var confExists = false;
                var i = 0;
                for (i = 0; i < global.connectionsConfs.length; i++) {
                    if ( global.connectionsConfs[i].machineid === data.machineid ) {
                        remote_machine_id = data.machineid;
                        confExists = true;
                        break;
                    }
                }

                console.log("confExists: "+confExists);
                if ( !confExists ) {
                    global.socket[address] = null;
                } else {
                
                    if ( data.op === 'returnHandShake' ) {
            
                        global.connectionsConfs[i].status = "connected";
                        global.mainWindow.webContents.executeJavaScript("loadConnectionsList("+JSON.stringify(global.connectionsConfs)+");");

                        // Starts to send files
                        fs.readdir('local_data/shares/', (err, local_shares_files) => {
                        
                            // Navigate through shares of this connection
                            var shares = global.connectionsConfs[i].shares;
                            for (var j = 0; j < shares.length; j++ ) {

                                for (var k = 0; k < local_shares_files.length; k++ ) {

                                    if ( local_shares_files[k].indexOf(shares[j]) != -1 ) {

                                        // Found a suittable file with configurations for this share
                                        console.log("Transmiting file "+local_shares_files[k]+" to the remote partner connection.");
                                        
                                        //send a file to the server
                                        var base64 = (fs.readFileSync('local_data/shares/'+local_shares_files[k])).toString('base64');

                                        var len = base64.length;
                                        var numbOfFiles = Math.ceil(len/global.transaction_syze);

                                        var now = (new Date()).getTime();

                                        var hash = local_shares_files[k].substring(0, local_shares_files[k].indexOf("_"));
                                        console.log("hash to send: "+hash);

                                        console.log("File to send: "+local_shares_files[k]);

                                        for (var l = 0; l < numbOfFiles; l++) {

                                            var init = l*global.transaction_syze;
                                            var end = (l+1)*global.transaction_syze;
                                            if ( end > len ) {
                                                end = len;
                                            }

                                            var base64part = base64.substring(init, end);
                                            global.client[origin_address].write("@IOT@"+JSON.stringify({'op': 'sendSyncroReportFile', 'machineid': global.machineInfo.id, 'filename': 'remote_data/shares/'+local_shares_files[k], 'numbOfFiles': numbOfFiles, 'counter': l, 'base64part': base64part, 'hash': hash, 'time': now})+"@EOT@");

                                        }

                                    }

                                }

                            }

                        });

                    } else if ( data.op === 'returnSendSyncroReportFile' ) {

                        var original_instructions = JSON.parse(fs.readFileSync('local_data/instructions.json', 'utf8'));
                        var new_instructions = data.instructions;
                        
                        for (var i = 0; i < new_instructions.length; i++) {

                            for (var j = 0; j < original_instructions.length; j++) {
                                var exists = false;
                                if ( original_instructions[j].op == new_instructions[i].op && original_instructions[j].path == new_instructions[i].path && original_instructions[j].machineid == new_instructions[i].machineid ) {
                                    exists = true;
                                    break;
                                }
                            }

                            if ( !exists ) {
                                original_instructions.push(new_instructions[i]);
                            }

                        }

                        // Save the instructions to the file again
                        fs.writeFileSync('local_data/instructions.json', JSON.stringify(original_instructions), 'utf8');

                    } else if ( data.op === 'returnGetFile' ) {

                        console.log("received returnGetFile ==> data.counter: "+data.counter+", data.numbOfFiles: "+data.numbOfFiles+", data.filename: "+data.filename+", data.hash: "+data.hash+", data.time: "+data.time+", data.address: "+data.address+", data.len: "+data.len);

                        global.received_files.push(data);
                        pearlsync_tools.checkReceivedFileSync();

                        global.client[origin_address].write("@IOT@"+JSON.stringify({'op': 'transferConcluded', 'machineid': global.machineInfo.id, 'counter': data.counter, "numbOfFiles": data.numbOfFiles, 'filename': data.filename, 'hash': data.hash, 'len': data.len, 'address': data.address, 'time': data.time})+"@EOT@");

                    }

                }

            }

        });

        console.log("Sending hand shake...");
        global.client[origin_address].write("@IOT@"+JSON.stringify({'op': 'handShake', 'machineid': global.machineInfo.id})+"@EOT@");
        
    });

    global.client[origin_address].setTimeout(5000, function () {
        global.client[origin_address].setTimeout(0);
        if ( counter < connectionConf.local_ip.length ) {
            counter++;
            tryLocalConnection(connectionConf, origin_address, punchConf, data, counter);
        } else {
            // If local connection could not be stablished within 10 seconds, try the hole punch approach
            tryPunchConnection(data, punchConf);
        }
    });

    global.client[origin_address].on('error', function (error) {
        global.client[origin_address].setTimeout(0);
        if ( counter < connectionConf.local_ip.length ) {
            counter++;
            tryLocalConnection(connectionConf, origin_address, punchConf, data, counter);
        } else {
            // If local connection could not be stablished within 10 seconds, try the hole punch approach
            tryPunchConnection(data, punchConf);
        }
    });

    global.client[origin_address].on('end', function (error) {

        for (var i = 0; i < global.connectionsConfs.length; i++) {
            if ( global.connectionsConfs[i].machineid === remote_machine_id ) {
                global.connectionsConfs[i].status = "disconnected";
                global.mainWindow.webContents.executeJavaScript("loadConnectionsList("+JSON.stringify(global.connectionsConfs)+");");
                break;
            }
        }

    });

}