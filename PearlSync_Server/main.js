const PouchDB = require('pouchdb');
const shares_db = new PouchDB('shares');
const invitations_db = new PouchDB('invitations');
const net = require('net');

var socket = [];
var details = [];

var resetDB = false;
if ( resetDB ) {
	shares_db.destroy().then(function () {
		// database destroyed
	}).catch(function (err) {
		// error occurred
	});
}

// assuming will connect first:
var server = net.createServer(function (socket_) {
	var address = socket_.address().remoteAddress+":"+socket_.address().remotePort;
	//console.log("Stablishing connection with "+address);
	socket[address] = socket_;
	Connects(address);
});

server.listen(9999, function (err) {
	if(err) return console.log(err);
	console.log('server listening on', server.address().address + ':' + server.address().port);
});

function Connects (address) {

	socket[address].on('data', function (data) {

		console.log("received data => "+data);

		data = JSON.parse(data);

		var id = data.machineid;
		/*console.log('> ('+id+') assuming '+id+' is connecting');
		console.log('> ('+id+') remote address and port are:', socket[address].remoteAddress, socket[address].remotePort);
		console.log('> ('+id+') storing this for when another pair connects');*/

		details[id] = {};
		details[id].remoteAddress = socket[address].remoteAddress;
		details[id].remotePort = socket[address].remotePort;

		if ( data.op === 'postNewShare' ) {
			
			shares_db.put({"_id": data.hash, clients: [{"machineid": data.machineid, "hostname": data.hostname}]});
			socket[address].write(JSON.stringify({'op': 'returnSaveNewShare', 'result': 'success', 'hash': data.hash, 'path': data.path}));

		} else if ( data.op === 'getSharePairs' ) {

			var returnObj = [];
			for (var i = 0; i < data.data.length; i++) {
				returnObj.push({"hash": data.data[i].hash, "clients": []});
				shares_db.get(data.data[i].hash).then(function (doc) {
					returnObj[returnObj.length-1].clients = doc.clients;
					socket[address].write(JSON.stringify({'op': 'returnGetSharePairs', 'data': returnObj}));
				}).catch(function(err){
					socket[address].write(JSON.stringify({'op': 'returnGetSharePairs', 'data': returnObj}));
				})
			}

		} else if ( data.op === 'saveShareInvitation' ) {

			var timeout = (new Date().getTime());
			invitations_db.put({'_id': data.id, 'share_hash': data.share_hash, 'timeout': timeout});
			socket[address].write(JSON.stringify({'op': 'returnShareInvitation', 'share_inivtation_id': data.id, 'timeout': timeout, 'share_hash': data.share_hash}));

		}

        /*console.log('> (S->A) sending B\'s details:', detailsB);
		socketA.write(JSON.stringify(detailsB));

		console.log('> (S->B) sending A\'s details:', detailsA);
		socketB.write(JSON.stringify(detailsA));*/

    });

	socket[address].on('end', function () {
	    console.log('> ('+socket[address].address.ip+':'+socket[address].address.port+') connection closed.');
	    socket[address] = null;
	});

	socket[address].on('error', function (err) {
	    console.log('> ('+socket[address].address.ip+':'+socket[address].address.port+') connection closed with err (',err,').');
	    socket[address] = null;
	});

}