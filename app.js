"use strict";
Object.defineProperty(exports, "__esModule", {
    value: true
});
const express = require("express");
const path = require("path");
const http = require('http');
const app = express();
const webServer = http.createServer(app);
// WebSockets
const webSocketServer = require('ws').Server;
const ws = new webSocketServer({
    server: webServer
});
//run the websocket webserver
webServer.listen(80, function listening() {
    console.log('Listening on %d', webServer.address().port);
});
//name variables
let collection, collection2, database, throttledUsers, throttledUsers2, cloudflare;
cloudflare = false;
throttledUsers = new Set();
throttledUsers2 = new Set();
// mongo
let mongodb = require('mongodb').MongoClient,
    assert = require('assert');
// Connection URL
const dbUrl = "mongodb://localhost/db";
// Use connect method to connect to the server
mongodb.connect(dbUrl, {
    auth: {
        user: '',
        password: ''
    },
    useNewUrlParser: true
}, function (err, client) {
    assert.equal(null, err);
    if (err)
        throw `MongoDB failed to initiate. ${err}`;
    database = client.db('socketbbs');
    console.log(`MongoDB connected!`);
});
// view engine setup
app.use(express.static(path.join(__dirname, 'public')));
// don't kill the process if a library fails
process.on('uncaughtException', function (err) {
    console.log("UNCAUGHT EXCEPTION\n" + err);
});
const clients = new Map();
ws.on('connection', function connection(ws, req) {
    // get, store and verify client IP
    let ID = makeid();
    let realIP;
    cloudflare ? realIP = req.headers['cf-connecting-ip'] : realIP = req.connection.remoteAddress;
    console.log(`${realIP} just connected.`);
    //set current board and thread to default
    let currBoard = 0;
    let threadID = 0;
    // set client states
    if (!clients.has(ID)) {
        clients.set(ID, {
            socket: ws,
            board: currBoard,
            threadID: threadID,
            ID: ID
        });
        // Update user count on client side
        wsBroadcastBoard(JSON.stringify({
            command: 'getUsers',
            argument: clients.size
        }), 0);
    } else {
        // set client states
        clients.delete(ID);
        clients.set(ID, {
            socket: ws,
            board: currBoard,
            threadID: threadID,
            ID: ID
        });
        console.log(`${realIP} disconnected.`);
        // Update user count on client side
        wsBroadcastBoard(JSON.stringify({
            command: 'getUsers',
            argument: clients.size
        }), 0);
        //return;
    }
    ws.on('close', function () {
        //remove client from currently connected users
        clients.delete(ID);
        // Update user count on client side
        wsBroadcastBoard(JSON.stringify({
            command: 'getUsers',
            argument: clients.size
        }), 0);
    });
    ws.on('message', function incoming(message) {
        for (let i = 0; i < message.length; i++) {
            if (message[i].match(`/[^\x00-\x7F]/g`)) {
                return;
            }
        }
        if (ws.readyState !== 1) {
            return;
        }
        //define variables
        let alertStr;
        // prevent users the server isn't aware of from connecting
        if (!ID) {
            alertStr = 'Error.';
            wsAlert(ID, alertStr);
            return;
        }
        let msg = message.split(",");
        // submitting a reply
        if (msg[0] === 'submitMessage') {
            //define variables
            let post;
            let postArr = [];
            let threadID;
            let nick;
            let currBoard;
            //Formulate contents of post
            for (let i = 0; i < msg.length; i++) {
                if (i > 3) {
                    postArr.push(msg[i]);
                }
            }
            post = postArr.join();
            if (post.length > 1500) {
                return;
            }
            currBoard = msg[1];
            threadID = msg[2];
            nick = msg[3];
            if (currBoard > 0) {
                return;
            }
            // is this a valid command? if so, continue
            if (msg[0] in cmd && post.length > 0) {
                let funct = cmd[msg[0]];
                funct(ID, currBoard, threadID, nick, post, realIP);
            }
        }
        // submit a thread
        if (msg[0] === 'submitThread') {
            let nick, post;
            let postArr = [];
            let currBoard;
            for (let i = 0; i < msg.length; i++) {
                if (i > 2) {
                    postArr.push(msg[i]);
                }
            }
            post = postArr.join();
            if (post.length > 1500) {
                return;
            }
            if (post.length < 35) {
                alertStr = 'Your post is too short. Please try again.';
                wsAlert(ID, alertStr);
                return;
            }
            currBoard = msg[1];
            nick = msg[2];
            if (currBoard > 0) {
                return;
            }
            // is this a valid command? if so, continue
            if (msg[0] in cmd && post.length > 0) {
                let funct = cmd[msg[0]];
                funct(ID, currBoard, nick, post, realIP);
            }
        }
        // get and display threads
        if (msg[0] === 'getThreads') {
            let currBoard;
            currBoard = msg[1];
            clients.set(ID, {
                socket: ws,
                board: currBoard,
                threadID: 0,
                ID: ID,
                upload: ``
            });
            if (currBoard > 0) {
                return;
            }
            if (msg[0] in cmd) {
                let funct = cmd[msg[0]];
                funct(ID, currBoard);
            }
        }
        // get and display posts within a thread
        if (msg[0] === 'getMessages') {
            let threadID;
            let currBoard;
            currBoard = msg[1];
            threadID = msg[2];
            //update client states
            clients.set(ID, {
                socket: ws,
                board: currBoard,
                threadID: threadID,
                ID: ID
            });
            if (currBoard > 0) {
                return;
            }
            if (msg[0] in cmd) {
                let funct = cmd[msg[0]];
                funct(ID, currBoard, threadID);
            }
        }
    });
    // Server commands go here
    const cmd = {
        getMessages: (ID, boardNum, threadID) => {
            if (ws.readyState !== 1) {
                return;
            }
            if (boardNum !== 0) {
                boardNum = 0
            }
            console.log(`${boardNum}:${threadID} to ${ID}.`);
            clients.get(ID).board = boardNum;
            collection = database.collection('posts');
            collection.find({
                board: boardNum,
                threadID: threadID
            }).limit(400).toArray(function (err, docs) {
                assert.equal(err, null);
                let parsedDocs = JSON.stringify(docs);
                console.log(`${ID} requested contents of ${threadID}`);
                ws.send(JSON.stringify({
                    command: 'displayMessages',
                    argument: docs
                }));
            });
        },
        getThreads: (ID, boardNum) => {
            if (ws.readyState !== 1) {
                return;
            }
            if (boardNum !== 0) {
                boardNum = 0
            }
            console.log(`Board ${boardNum} to ${ID}.`);
            clients.get(ID).board = boardNum;
            collection = database.collection('threads');
            collection.find({
                board: boardNum
            }).sort({
                "date": -1
            }).limit(400).toArray(function (err, docs) {
                assert.equal(err, null);
                wsBroadcastBoard(JSON.stringify({
                    command: 'displayThreads',
                    argument: docs
                }), boardNum);
            });
        },
        submitMessage: (ID, boardNum, threadID, nick, post, realIP) => {
            if (ws.readyState !== 1) {
                return;
            }
            if (boardNum == 0) {
                boardNum = 0
            }
            let alertStr, username, messageObj, postID, pic;
            let dateNow = Date.now();
            if (!post) {
                alertStr = 'No message submitted.';
                wsAlert(ID, alertStr);
                return;
            } else if (throttledUsers.has(realIP)) {
                alertStr = 'You may only submit a new post every second.';
                wsAlert(ID, alertStr);
                return;
            }
            // spam prevention
            throttledUsers.add(realIP);
            clearThrottles(realIP);
            if (post.length > 1500) {
                return;
            } else {
                collection = database.collection('posts');
                collection2 = database.collection('threads');
                nick ? username = nick : username = 'Anonymous';
                if (post) {
                    collection.find().limit(1).sort({
                        $natural: -1
                    }).toArray(function (err, docs) {
                        assert.equal(err, null);
                        docs[0] ? postID = docs[0].postID + 1 : postID = 1;
                        messageObj = {
                            board: boardNum,
                            nick: username,
                            message: post,
                            threadID: threadID,
                            pic: pic,
                            date: dateNow,
                            postID: postID
                        };
                        collection2.updateOne({
                            threadID: threadID
                        }, {
                            $set: {
                                date: dateNow
                            }
                        }).then(collection.insertOne(messageObj).then(function () {
                            console.log(`completed message submission to #${threadID} time to broadcast`);
                            wsBroadcastThread(JSON.stringify({
                                command: 'displayMessage',
                                argument: messageObj
                            }), threadID);
                        })).then(setTimeout(function () {
                            cmd.getThreads(ID, boardNum);
                        }));
                    });
                }
            }
        },
        submitThread: (ID, boardNum, nick, message, realIP) => {
            if (ws.readyState !== 1) {
                return;
            }
            if (boardNum !== 0) {
                boardNum = 0
            }
            if (message > 1500) {
                return;
            }
            let alertStr, username, postID, pic, threadID, threadObj, messageObj;
            if (!message) {
                alertStr = `You didn't enter a message.`;
                return;
            }
            if (throttledUsers2.has(realIP)) {
                alertStr = 'You may only submit a new thread every five minutes.';
                wsAlert(ID, alertStr);
                return;
            }
            throttledUsers2.add(realIP);
            clearThrottles2(realIP);
            let dateNow = Date.now();
            collection = database.collection('threads');
            collection2 = database.collection('posts');
            nick ? username = nick : username = 'Anonymous';
            if (message) {
                collection.find().limit(1).sort({
                    $natural: -1
                }).toArray(function (err, docs) {
                    assert.equal(err, null);
                    threadID = makeid();
                    threadObj = {
                        board: boardNum,
                        nick: username,
                        message: message,
                        threadID: threadID,
                        pic: pic,
                        date: dateNow
                    };
                    if (threadObj && threadID) {
                        collection.insertOne(threadObj).then(function () {
                            collection2.find().limit(1).sort({
                                $natural: -1
                            }).toArray(function (err, docs) {
                                assert.equal(err, null);
                                docs[0] ? postID = docs[0].postID + 1 : postID = 1;
                                messageObj = {
                                    board: boardNum,
                                    nick: username,
                                    message: message,
                                    threadID: threadID,
                                    pic: pic,
                                    date: dateNow,
                                    postID: postID
                                };
                                if (messageObj && postID > -1) {
                                    collection2.insertOne(messageObj);
                                }
                            });
                        }).then(function () {
                            setTimeout(function () {
                                cmd.getThreads(ID, boardNum);
                            }, 500);
                        });
                    }
                });
            }
        }
    };
});
//broadcast only to users on a certain board
let wsBroadcastBoard = function (data, boardNum) {
    clients.forEach(function (client) {
        if (client.socket.readyState !== 1) {
            return;
        }
        if (client.threadID == 0) {
            client.socket.send(data);
        }
    });
};
//broadcast only to users in a certain thread
let wsBroadcastThread = (data, threadID) => {
    clients.forEach(function (client) {
        if (client.socket.readyState !== 1) {
            return;
        }
        if (client.threadID == threadID) {
            client.socket.send(data);
        }
    });
};
//broadcast to every user with no conditions
let wsBroadcast = (data) => {
    clients.forEach(function (client) {
        if (client.socket.readyState !== 1) {
            return;
        }
        client.socket.send(data);
    });
};
//broadcast only to a specific user
let wsBroadcastUser = (ID, data) => {
    clients.forEach(function (client) {
        if (client.socket.readyState !== 1) {
            return;
        }
        if (client.IP == ID) {
            client.socket.send(data);
        }
    });
};
let wsAlert = (ID, alertStr) => {
    let newAlert = JSON.stringify({
        alert: alertStr
    });
    wsBroadcastUser(ID, newAlert);
};
let clearThrottles = (IP) => {
    setTimeout(function () {
        throttledUsers.delete(IP);
        console.log(throttledUsers);
    }, 1000);
};
let clearThrottles2 = (IP) => {
    setTimeout(function () {
        throttledUsers2.delete(IP);
        console.log(throttledUsers2);
    }, 300000);
};
let makeid = () => {
    var text = "";
    var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (var i = 0; i < 16; i++)
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    return text;
};