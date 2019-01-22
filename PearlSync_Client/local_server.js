const net = require('net');
const fs = require('fs');
const unzip = new require('unzip');
const pearlsync_tools = require('./pearlsync_tools');

var serverBuffer = [];
var base64 = [];

function sendFileToClient(counter, numbOfFiles, filename, hash, now, address, len) {

    console.log("--------- sendFileToClient ["+counter+"] ---------------");
    console.log("numbOfFiles: "+numbOfFiles+", filename: "+filename+", hash: "+hash+", now: "+now+", address: "+address+", len: "+len);

    if ( counter < numbOfFiles ) {

        var init = counter*global.transaction_syze;
        var end = (counter+1)*global.transaction_syze;
        if ( end > len ) {
            end = len;
        }

        var base64part = base64[address].substring(init, end);
        var obj = {'op': 'returnGetFile', 'machineid': global.machineInfo.id, 'filename': filename, 'numbOfFiles': numbOfFiles, 'counter': counter, 'base64part': base64part, 'hash': hash, 'time': now, 'address': address, 'len': len};
        global.socket[address].write("@IOT@"+JSON.stringify(obj)+"@EOT@");

    } else {

        base64[address] = "";

    }

}

module.exports = {

    startLocalServer: function () {

        var server = net.createServer(function (socket_) {
    
            var remote_address = socket_.remoteAddress.replace("::ffff:", "")+":"+socket_.remotePort;
            console.log("Stablishing connection with "+remote_address+"\n");
        
            global.socket[remote_address] = socket_;
            Connects(remote_address);
            
        });
        
        function Connects (address) {
        
            var remote_machine_id = "";
        
            global.socket[address].on('data', function (data) {

                data = data+"";

                var complete = false;
                if ( data.indexOf("@IOT") != -1 && data.indexOf("@EOT@") != -1 ) {
                    complete = true;
                } else if ( data.indexOf("@IFT@") != -1  ) {
                    serverBuffer[address] = data;
                } else if ( data.indexOf("@EOT@") != -1  ) {
                    complete = true;
                    data = serverBuffer[address]+data;
                } else {
                    serverBuffer[address] = serverBuffer[address]+data;
                }
        
                if ( complete ) {

                    data = data.replace('@IOT@', '').replace('@EOT@', '');
                    console.log("received data => "+data+"\n");

                    data = JSON.parse(data);

                    var confExists = false;
                    var i = 0;
                    for (i = 0; i < global.connectionsConfs.length; i++) {
                        if ( global.connectionsConfs[i].machineid === data.machineid ) {
                            confExists = true;
                            break;
                        }
                    }
                
                    console.log("confExists => "+confExists);

                    if ( !confExists ) {
                        global.socket[address] = null;
                    } else {
                
                        if ( data.op === 'handShake' ) {
                
                            remote_machine_id = data.machineid;
                
                            global.connectionsConfs[i].machineid = data.machineid;
                            global.connectionsConfs[i].ip = global.socket[address].remoteAddress;
                            global.connectionsConfs[i].port = global.socket[address].remotePort;
                            global.connectionsConfs[i].type = "server";
                            global.connectionsConfs[i].pingtime = (new Date()).getTime();
                            global.connectionsConfs[i].status = "connected";
                
                            global.socket[address].write("@IOT@"+JSON.stringify({'op': 'returnHandShake', 'status': 'success', 'machineid': machineInfo.id})+"@EOT@");
                
                            global.mainWindow.webContents.executeJavaScript("loadConnectionsList("+JSON.stringify(connectionsConfs)+");");
                            
                        } else if ( data.op === 'sendSyncroReportFile' ) {

                            global.received_files.push(data);
                            pearlsync_tools.checkReceivedFileSync();

                            // Get list of shares
                            var share_list = JSON.parse(fs.readFileSync("local_data/sharelist.json", "utf8"));

                            // Process file and compare with local one
                            console.log("data.filename: "+data.filename);
                            fs.createReadStream(data.filename)
                                .pipe(unzip.Extract({path:'remote_data/shares/'}).on('close', function () {

                                    var hash = data.hash;
                                    console.log("Remote file to extract content: "+data.filename.replace('.zip', ''));
                                    var remoteFileContent = fs.readFileSync(data.filename.replace('.zip', ''));
                                    console.log("remoteFileContent: "+remoteFileContent);

                                    fs.unlink(data.filename, (err) => {
                                        if (err) {
                                            throw "Error while deleting file "+data.filename+" ===> "+err;
                                        } else {
                                            console.log(data.filename+' was deleted');
                                        }
                                    });

                                    fs.unlink(data.filename.replace('.zip', ''), (err) => {
                                        if (err) {
                                            throw "Error while deleting file "+data.filename.replace('.zip', '')+" ===> "+err;
                                        } else {
                                            console.log(data.filename.replace('.zip', '')+' was deleted');
                                        }
                                    });

                                    var remote_structure = JSON.parse(remoteFileContent);
                                    
                                    fs.readdir('local_data/shares/', (err, local_shares_files) => {

                                        for (var j = 0; j < local_shares_files.length; j++) {
                                            
                                            //console.log("hash to compare: "+hash);
                                            if ( local_shares_files[j].indexOf(hash) != -1 ) {

                                                // File found
                                                fs.createReadStream('local_data/shares/'+local_shares_files[j])
                                                    .pipe(unzip.Extract({path:'local_data/shares/'}).on('close', function () {

                                                        var localFileName = 'local_data/shares/'+local_shares_files[j].replace(".zip", "");
                                                        var localFileContent = fs.readFileSync(localFileName);
                                                        
                                                        fs.unlink(localFileName, (err) => {
                                                            if (err) {
                                                                throw err;
                                                            } else {
                                                                console.log(localFileName+' was deleted');
                                                            }
                                                        });

                                                        var local_structure = JSON.parse(localFileContent);

                                                        var relative_path = "";
                                                        for (var k = 0; k < share_list.length; k++) {
                                                            if ( share_list[k].hash === hash ) {
                                                                relative_path = share_list[k].path;
                                                                break;
                                                            }
                                                        }

                                                        var instructions = pearlsync_tools.compareStructures(remote_structure.children, local_structure.children, [], 'remote', global.machineInfo.id, relative_path, hash);
                                                        console.log("instructions: "+JSON.stringify(instructions));

                                                        global.socket[address].write("@IOT@"+JSON.stringify({'op': 'returnSendSyncroReportFile', 'machineid': global.machineInfo.id, 'hash': hash, 'instructions': instructions})+"@EOT@");

                                                    }));

                                                break;

                                            }

                                        }

                                    });

                                }));

                        } else if ( data.op === 'getFile' ) {

                            // Get relative path
                            var relative_path = "";
                            var share_list = JSON.parse(fs.readFileSync("local_data/sharelist.json", "utf8"));
                            for (var j = 0; j < share_list.length; j++) {
                                if ( share_list[j].hash === data.hash ) {
                                    relative_path = share_list[j].path;
                                    break;
                                }
                            }

                            // Open file to send
                            base64[address] = (fs.readFileSync(relative_path+data.filename)).toString('base64');

                            var len = base64[address].length;
                            var numbOfFiles = Math.ceil(len/global.transaction_syze);

                            var now = (new Date()).getTime();

                            sendFileToClient(0, numbOfFiles, data.filename, data.hash, now, address, len);
                            
                        } else if ( data.op === 'sendFile' ) {

                            //global.received_files.push(data);
                            //pearlsync_tools.checkReceivedFileSync();

                        } else if ( data.op === 'transferConcluded' ) {

                            console.log("data.counter: "+data.counter+", data.numbOfFiles: "+data.numbOfFiles+", data.filename: "+data.filename+", data.hash: "+data.hash+", data.time: "+data.time+", data.address: "+data.address+", data.len: "+data.len);
                            sendFileToClient(data.counter+1, data.numbOfFiles, data.filename, data.hash, data.time, data.address, data.len);

                        }
                
                    }

                }

            });
        
            global.socket[address].on('end', function () {
        
                try {
                    console.log('> ('+global.socket[address].remoteAddress+':'+global.socket[address].remotePort+') connection closed.\n');
                } catch (Error) {}
        
                for (var i = 0; i < connectionsConfs.length; i++) {
                    if ( connectionsConfs[i].machineid === remote_machine_id ) {
                        connectionsConfs[i].status = "disconnected";
                        global.mainWindow.webContents.executeJavaScript("loadConnectionsList("+JSON.stringify(connectionsConfs)+");");
                        break;
                    }
                }
        
                global.socket[address] = null;
                
            });
        
            global.socket[address].on('error', function (err) {        
                try {
                    console.log('> ('+global.socket[address].remoteAddress+':'+global.socket[address].remotePort+') connection closed with err (',err,').\n');
                } catch (Error) {}
                global.socket[address] = null;
            });
            
        }
        
        server.listen(9999, function (err) {
            if (err) {
                return console.log(err+"\n");
            }
            console.log('server listening on', server.address().address + ':' + server.address().port+"\n");
        });

    }

}