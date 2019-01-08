const PouchDB = require('pouchdb');
const shares_db = new PouchDB('shares');
const invitations_db = new PouchDB('invitations');
const net = require('net');

var socket = [];
var details = [];

var resetDB = false;
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

		if ( data.op === 'postNewShare' ) {
			
			shares_db.put({"_id": data.hash, clients: [{"machineid": data.machineid, "hostname": data.hostname}]});
			socket[address].write(JSON.stringify({'op': 'returnSaveNewShare', 'result': 'success', 'hash': data.hash, 'path': data.path}));

		} else if ( data.op === 'importNewShare' ) {

			invitations_db.get(data.invitation_hash).then(function (doc1) {
				shares_db.get(doc1.share_hash).then(function (doc2) {
					var tempClients = doc2.clients;
					tempClients.push({"machineid": data.machineid, "hostname": data.hostname});
					shares_db.put({"_rev": doc2._rev, "clients": tempClients});
					socket[address].write(JSON.stringify({'op': 'returnSaveNewShare', 'result': 'success', 'hash': doc2._id, 'path': data.path}));
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

		}

        /*console.log('> (S->A) sending B\'s details:', detailsB);
		socketA.write(JSON.stringify(detailsB));

		console.log('> (S->B) sending A\'s details:', detailsA);
		socketB.write(JSON.stringify(detailsA));*/

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