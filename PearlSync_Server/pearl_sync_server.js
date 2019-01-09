const PouchDB = require('pouchdb');
const shares_db = new PouchDB('shares');
const invitations_db = new PouchDB('invitations');
const net = require('net');

var resetDB = false;
var isDBDebug = false;

var socket = [];
var details = [];

function processArgs(args) {

	args = args.split(',');

    for (var i = 0; i < args.length; i++) {
		if ( args[i].indexOf('factory_reset=true') != -1 ) {
			resetDB = true;
		} else if ( args[i].indexOf('db_debug=true') != -1 ) {
			isDBDebug = true;
		}
	}

}
processArgs(process.argv+'');
	
if ( resetDB ) {
	
	shares_db.destroy().then(function () {
		shares_db = new PouchDB('shares');
	}).catch(function (err) {
		// error occurred
	});

	invitations_db.destroy().then(function () {
		invitations_db = new PouchDB('shares');
	}).catch(function (err) {
		// error occurred
	});

}

if ( isDBDebug ) {

	shares_db.allDocs({
		include_docs: true,
		attachments: true
	}).then(function (result) {
		for (var i = 0; i < result.rows.length; i++) {
			console.log("shares ===> "+JSON.stringify(result.rows[i]));
		}
	}).catch(function (err) {
		console.log(err);
	});

	invitations_db.allDocs({
		include_docs: true,
		attachments: true
	}).then(function (result) {
		for (var i = 0; i < result.rows.length; i++) {
			console.log("invitations ===> "+JSON.stringify(result.rows[i]));
		}
	}).catch(function (err) {
		console.log(err);
	});

}

// assuming will connect first:
var server = net.createServer(function (socket_) {
	var address = socket_.address().remoteAddress+":"+socket_.address().remotePort;
	//console.log("Stablishing connection with "+address+"\n");
	socket[address] = socket_;
	Connects(address);
});

server.listen(9999, function (err) {
	if(err) return console.log(err+"\n");
	console.log('server listening on', server.address().address + ':' + server.address().port+"\n");
});

function Connects (address) {

	socket[address].on('data', function (data) {

		console.log("received data => "+data+"\n");

		data = JSON.parse(data);

		var id = data.machineid;
		/*console.log('> ('+id+') assuming '+id+' is connecting\n');
		console.log('> ('+id+') remote address and port are:', socket[address].remoteAddress, socket[address].remotePort);
		console.log('> ('+id+') storing this for when another pair connects\n');*/

		details[id] = {};
		details[id].remoteAddress = socket[address].remoteAddress;
		details[id].remotePort = socket[address].remotePort;
		details[id].pingtime = (new Date()).getTime();
		details[id].hostname = data.hostname;
		details[id].machineid = id;

		if ( data.op === 'postNewShare' ) {
			
			shares_db.put({"_id": data.hash, clients: [{"machineid": data.machineid, "hostname": data.hostname}]});
			socket[address].write(JSON.stringify({'op': 'returnSaveNewShare', 'result': 'success', 'hash': data.hash, 'path': data.path}));

		} else if ( data.op === 'importNewShare' ) {

			invitations_db.get(data.invitation_hash).then(function (doc1) {
				shares_db.get(doc1.share_hash).then(function (doc2) {
					doc2.clients.push({"machineid": data.machineid, "hostname": data.hostname});
					console.log("tempClients before write to db ====> "+JSON.stringify(doc2.clients))
					shares_db.put(doc2);
					socket[address].write(JSON.stringify({'op': 'returnSaveNewShare', 'result': 'success', 'hash': doc1.share_hash, 'path': data.path}));
				});
			});

		} else if ( data.op === 'getSharePairs' ) {

			var counter = 0;
			var returnObj = [];
			for (var i = 0; i < data.data.length; i++) {
				returnObj.push({"hash": data.data[i].hash, "clients": null});
				shares_db.get(data.data[i].hash).then(function (doc) {
					for (var j = 0; j < data.data.length; j++) {
						if ( doc._id === data.data[j].hash ) {
							returnObj[j].clients = doc.clients;
							break;
						}
					}
					counter++;
				}).catch(function(err){
					console.log("getSharePairs ==> err => "+err+"\n");
				})
			}

			var i1 = setInterval(function () {
				if ( counter === data.data.length ) {
					socket[address].write(JSON.stringify({'op': 'returnGetSharePairs', 'data': returnObj}));
					clearInterval(i1);
				}
			}, 100);
			
		} else if ( data.op === 'saveShareInvitation' ) {

			var timeout = (new Date().getTime());
			invitations_db.put({'_id': data.id, 'share_hash': data.share_hash, 'timeout': timeout});
			socket[address].write(JSON.stringify({'op': 'returnShareInvitation', 'share_invitation_id': data.id, 'timeout': timeout, 'share_hash': data.share_hash}));

		} else if ( data.op === 'getPunchConfigFromIP' ) {

			var ip = data.ip;
			var port = data.port;

			var machineid = "";
			var hostname = "";
			var pingtime = 0;
			for (var i = 0; i < details.length; i++) {
				if ( details[i].ip === ip && details[i].port === port ) {
					machineid = details[i].machineid;
					hostname = details[i].hostname;
					pingtime = details[i].pingtime;
					type = data.type;
					break;
				}
			}

			socket[address].write(JSON.stringify({'op': 'returnGetPunchConfigFromIP', 'hostname': hostname, 'machineid': machineid, 'pingtime': pingtime, 'type': type, 'ip': ip, 'port': port}));

		}

    });

	socket[address].on('end', function () {
	    console.log('> ('+socket[address].address.ip+':'+socket[address].address.port+') connection closed.\n');
	    socket[address] = null;
	});

	socket[address].on('error', function (err) {
	    console.log('> ('+socket[address].address.ip+':'+socket[address].address.port+') connection closed with err (',err,').\n');
	    socket[address] = null;
	});

}