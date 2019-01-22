const PouchDB = require('pouchdb');
const shares_db = new PouchDB('shares');
const invitations_db = new PouchDB('invitations');
const net = require('net');

var resetDB = false;
var isDBDebug = false;

var socket = [];
var details = [];

var welcome_text =
"-----------------------------------------\n"+
"| Welcome to PearlSync Server Mode      |\n"+
"|                                       |\n"+
"| Copyright (c) 2019 Paulo André Rieck  |\n"+
"| Licensed per MIT License              |\n"+
"|                                       |\n"+
"| paulo.rieck@gmail.com                 |\n"+
"-----------------------------------------\n\n";
console.log(welcome_text);

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
	var address = socket_.remoteAddress.replace("::ffff:", "")+":"+socket_.remotePort;
	console.log("Stablishing new connection with "+address+"\n");
	socket[address] = socket_;
	Connects(address);
});

server.listen(9999, function (err) {
	if(err) return console.log(err+"\n");
	console.log('server listening on', server.address().address + ':' + server.address().port+"\n");
});

function Connects (address) {

	socket[address].on('data', function (data) {

		data = data+"";

		data = data.replace("@IOT@", '').replace("@EOT@", '');

		console.log("received data => "+data+"\n");

		data = JSON.parse(data);

		details[data.machineid] = {};
		details[data.machineid].remoteAddress = socket[address].remoteAddress.replace("::ffff:", "");
		details[data.machineid].remotePort = socket[address].remotePort;
		details[data.machineid].pingtime = (new Date()).getTime();
		details[data.machineid].hostname = data.hostname;
		details[data.machineid].machineid = data.machineid;
		details[data.machineid].local_ip = data.local_ip;

		if ( data.op === 'postNewShare' ) {
			
			shares_db.put({"_id": data.hash, clients: [{"machineid": data.machineid, "hostname": data.hostname}]});
			socket[address].write(
				"@IOT@"+
				JSON.stringify({
					'op': 'returnSaveNewShare',
					'result': 'success',
					'hash': data.hash,
					'path': data.path
				})+
				"@EOT@");

		} else if ( data.op === 'importNewShare' ) {

			invitations_db.get(data.invitation_hash).then(function (doc1) {
				shares_db.get(doc1.share_hash).then(function (doc2) {
					doc2.clients.push({"machineid": data.machineid, "hostname": data.hostname});
					console.log("tempClients before write to db ====> "+JSON.stringify(doc2.clients))
					shares_db.put(doc2);
					socket[address].write(
						"@IOT@"+
						JSON.stringify({
							'op': 'returnSaveNewShare',
							'result': 'success',
							'hash': doc1.share_hash,
							'path': data.path
						})+
						"@EOT@");
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
					socket[address].write("@IOT@"+JSON.stringify({'op': 'returnGetSharePairs', 'data': returnObj})+"@EOT@");
					clearInterval(i1);
				}
			}, 100);
			
		} else if ( data.op === 'saveShareInvitation' ) {

			var timeout = (new Date().getTime());
			invitations_db.put({'_id': data.id, 'share_hash': data.share_hash, 'timeout': timeout});
			socket[address].write(
				"@IOT@"+
				JSON.stringify({
					'op': 'returnShareInvitation',
					'share_invitation_id': data.id,
					'timeout': timeout,
					'share_hash': data.share_hash
				})+
				"@EOT@");

		} else if ( data.op === 'getPunchConfigFromIP' ) {

			var ip = data.ip;
			var port = data.port;

			var machineid = "";
			var hostname = "";
			var pingtime = 0;
			var local_ip = [];
			for (var i = 0; i < details.length; i++) {
				if ( details[i].ip === ip && details[i].port === port ) {
					machineid = details[i].machineid;
					hostname = details[i].hostname;
					pingtime = details[i].pingtime;
					type = data.type;
					local_ip = details[i].local_ip;
					break;
				}
			}

			socket[address].write(
				"@IOT@"+
				JSON.stringify({
					'op': 'returnGetPunchConfigFromIP',
					'hostname': hostname,
					'machineid': machineid,
					'pingtime': pingtime,
					'type': type,
					'ip': ip,
					'port': port,
					'local_ip': local_ip
				})+
				"@EOT@");

		} else if ( data.op === 'getPunchDetailsFromIDsList' ) {

			var machines_list = data.list;
			for (var i = 0; i < machines_list.length; i++) {
				if ( details[machines_list[i].machineid] != null && typeof details[machines_list[i].machineid] != "undefined" ) {
					machines_list[i].status = 'ready_for_connection';
					machines_list[i].ip = details[machines_list[i].machineid].remoteAddress;
					machines_list[i].port = details[machines_list[i].machineid].remotePort;
					machines_list[i].local_ip = details[machines_list[i].machineid].local_ip;
				} else {
					machines_list[i].status = 'disconnected';
				}
			}

			socket[address].write(
				"@IOT@"+
				JSON.stringify({
					'op': 'returnGetPunchDetailsFromIDsList',
					'data': machines_list,
					'originip': socket[address].remoteAddress.replace("::ffff:", ""),
					'originport': socket[address].remotePort
				})+
				"@EOT@");

		} else if ( data.op === 'sendPunchRequest' ) {

			var destiny_address = data.data.punchDestinyIP+":"+data.data.punchDestinyPort;
			console.log('sendPunchRequest ==> destiny_address: '+destiny_address);
			socket[destiny_address].write("@IOT@"+JSON.stringify({'op': 'forwardPunchRequest', 'data': data.data})+"@EOT@");

		} else if ( data.op === 'returnForwardPunchRequest' ) {

			var origin_address = data.data.punchOriginIP+":"+data.data.punchOriginPort;
			socket[origin_address].write("@IOT@"+JSON.stringify({'op': 'returnSendPunchRequest', 'data': data.data})+"@EOT@");

		}

	});

	socket[address].on('end', function () {
		console.log('> ('+socket[address].remoteAddress.replace("::ffff:", "")+':'+socket[address].remotePort+') connection closed.\n');
		nullifyConnectionDetails(socket[address]);
		socket[address] = null;
	});

	socket[address].on('error', function (err) {
		console.log('> ('+socket[address].remoteAddress.replace("::ffff:", "")+':'+socket[address].remotePort+') connection closed with err (',err,').\n');
		nullifyConnectionDetails(socket[address]);
	    socket[address] = null;
	});

}

function nullifyConnectionDetails(socket) {

	var new_details = [];
	for (var i in details) {
		console.log("1) details["+i+"]: "+JSON.stringify(details[i]));
		if ( details[i].remoteAddress !== socket.remoteAddress.replace("::ffff:", "") || details[i].remotePort !== socket.remotePort ) {
			new_details[details[i].remoteAddress+":"+details[i].remotePort] = details[i];	
		}
	}
	details = new_details;
	console.log("Connection with "+socket.remoteAddress.replace("::ffff:", "")+':'+socket.remotePort+" correcly nullified!");

}