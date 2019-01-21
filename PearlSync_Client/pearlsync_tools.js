const fs = require('fs');

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
            JSON.stringify({
                "op": "getPunchDetailsFromIDsList",
                "list": machinesids_list,
                'machineid': global.machineInfo.id,
                'hostname': global.machineInfo.hostname,
                'local_ip': global.machineInfo.local_ip
            }));
    
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
            global.client['server'].write(JSON.stringify(post_data));
        } else {
            setTimeout(function () {
                this.executeGetShareList(data);
            }, 10000);
        }
    
    },

    compareStructures: function (oldStructure, currentStructure, instructions, type) {

        for (var i = 0; i < oldStructure.length; i++) {
            
            var removed = true;
            var changed = false;
            for (var j = 0; j < currentStructure.length; j++) {
                if ( oldStructure[i].path === currentStructure[j].path && oldStructure[i].type === currentStructure[j].type ) {
                    removed = false;
                    if ( oldStructure[i].type === 'folder' ) {
                        this.compareStructures(oldStructure[i].children, currentStructure[j].children, instructions, type);
                    } else if ( oldStructure[i].type === 'file' ) {
                        if ( oldStructure[i].last_modification !== currentStructure[j].last_modification ) {
                            changed = true;
                        }
                    }
                    break;
                }
            }
    
            if ( removed ) {
                if ( type == 'local' ) {
                    instructions.push({'op': 'remove', 'path': oldStructure[i].path, 'execution': 0, 'type': oldStructure[i].type});
                } else if ( type == 'remote' ) {

                }
            } else if ( changed ) {
                if ( type == 'local' ) {
                    instructions.push({'op': 'change', 'path': oldStructure[i].path, 'execution': 0, 'type': oldStructure[i].type});
                } else if ( type == 'remote' ) {

                }
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
                if ( type == 'local' ) {
                    instructions.push({'op': 'add', 'path': currentStructure[i].path, 'execution': 0, 'type': currentStructure[i].type});
                } else if ( type == 'remote' ) {

                }
            }
    
        }
    
        return instructions;
    
    }

}