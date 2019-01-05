module.exports = {

    connectToS: function (id) {

        console.log('> ('+id+'->S) connecting to S');
    
        socketToS = require('net').createConnection({host : addressOfS, port : portOfS}, function () {
            
            console.log('> ('+id+'->S) connected to S via', socketToS.localAddress, socketToS.localPort);
    
    
            // letting local address and port know to S so it can be can be sent to client B:
            socketToS.write(JSON.stringify({
                name: id,
                localAddress: socketToS.localAddress,
                localPort: socketToS.localPort
            }));
            
        });
    
        socketToS.on('data', function (data) {
    
            console.log('> ('+id+'->S) response from S:', data.toString());
    
            var connectionDetails = JSON.parse(data.toString());
            if(connectionDetails.name == id) {
                // own connection details, only used to display the connection to the server in console:
                console.log("");
                console.log('> ('+id+')', socketToS.localAddress + ':' + socketToS.localPort, '===> (NAT of '+id+')', connectionDetails.remoteAddress + ':' + connectionDetails.remotePort, '===> (S)', socketToS.remoteAddress + ':' + socketToS.remotePort);
                console.log("");
            }
    
    
            if(connectionDetails.name != id) {
                console.log('> ('+id+') time to listen on port used to connect to S ('+socketToS.localPort+')');
                listen(socketToS.localAddress, socketToS.localPort);
    
                // try connecting to B directly:
                connectTo(connectionDetails.remoteAddress, connectionDetails.remotePort);
            }
        });
    
        socketToS.on('end', function () {
            console.log('> ('+id+'->S) connection closed.');
        });
    
        socketToS.on('error', function (err) {
            console.log('> ('+id+'->S) connection closed with err:', err.code);
        });
    }

}

var readline = require('readline');

var rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

var addressOfS = 'x.x.x.x'; // replace this with the IP of the server running publicserver.js
var portOfS = 9999;

var socketToS;
var tunnelEstablished = false;

function connectTo (ip, port) {
	if(tunnelEstablished) return;

	console.log('> ('+id+'->B) connecting to B: ===> (B)', ip + ":" + port);
	var c = require('net').createConnection({host : ip, port : port}, function () {
		console.log('> ('+id+'->B) Connected to B via', ip + ":" + port);
		tunnelEstablished = true;
	});

	c.on('data', function (data) {
	    console.log('> ('+id+'->B) data from B:', data.toString());
	});

	c.on('end', function () {
	    console.log('> ('+id+'->B) connection closed.');
	});

	c.on('error', function (err) {
	    console.log('> ('+id+'->B) connection closed with err:', err.code);
	    setTimeout(function () {
	    	connectTo(ip, port);
	    },500);
	});
}

var tunnelSocket = null;

function listen (ip, port) {

	var server = require('net').createServer(function (socket) {

		tunnelSocket = socket;

		console.log('> ('+id+') someone connected, it\s:', socket.remoteAddress, socket.remotePort);

	    socket.write("Hello there NAT traversal man, you are connected to "+id+"!");
	    tunnelEstablished = true;

        readStuffFromCommandLineAndSendToB();
        
	});

	server.listen(port, ip, function (err) {
		if(err) return console.log(err);
		console.log('> ('+id+') listening on ', ip + ":" + port);
    });
    
}

function readStuffFromCommandLineAndSendToB () {

	if(!tunnelSocket) return;

	rl.question('Say something to B:', function (stuff) {
		tunnelSocket.write(stuff);

		readStuffFromCommandLineAndSendToB();
    });
    
}