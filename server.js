const fs = require("fs");
const http = require("http");
const express = require("express");
const app = express();
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

// Serve files from root directory
app.use(express.static(__dirname));

/* ================= DATA ================= */

const NATO = [
  "ALPHA","BRAVO","CHARLIE","DELTA","ECHO","FOXTROT",
  "GOLF","HOTEL","INDIA","JULIET","KILO","LIMA","MIKE",
  "NOVEMBER","OSCAR","PAPA","QUEBEC","ROMEO","SIERRA",
  "TANGO","UNIFORM","VICTOR","WHISKEY","XRAY","YANKEE","ZULU",

  // NATO numbers
  "ZERO","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE",

  // digit numbers
  "0","1","2","3","4","5","6","7","8","9",

  // reserved/admin
  "CONTROL"
];

let users = [];
let mutedIPs = {}; // ip -> unmute timestamp
let adminPassword = "admin123";

/* ================= HELPERS ================= */

function isNatoOnly(text){
 return text
  .toUpperCase()
  .split(/[\s,]+/)
  .every(w => NATO.includes(w));
}

function broadcastUsers(){
 io.emit("userUpdate", users.map(u => ({
  socketId: u.id,
  callsign: u.callsign,
  name: u.name,
  admin: u.admin,
  ip: u.ip,
  connectedAt: u.connectedAt
 })));
}

function getUserByCallsign(c){
 return users.find(u => u.callsign === c);
}

/* ================= SOCKET ================= */

io.on("connection", socket => {
 const ip = socket.handshake.address;

 socket.on("register",(data,cb)=>{
  if(!isNatoOnly(data.callsign) || !isNatoOnly(data.name))
   return cb({ok:false,err:"NATO ONLY"});

  if(data.callsign.includes("CONTROL"))
   return cb({ok:false,err:"CONTROL RESERVED"});

  if(users.some(u=>u.callsign===data.callsign))
   return cb({ok:false,err:"CALLSIGN IN USE"});

  const user={
   id:socket.id,
   callsign:data.callsign,
   name:data.name,
   admin:false,
   ip,
   connectedAt:Date.now()
  };
  users.push(user);
  cb({ok:true});
  io.emit("system",{text:`${user.callsign} CONNECTED`});
  broadcastUsers();
 });

 /* ===== ADMIN LOGIN ===== */
 socket.on("becomeAdmin",(d,cb)=>{
  if(d.password!==adminPassword)
   return cb({ok:false,err:"BAD PASSWORD"});

  const u=users.find(x=>x.id===socket.id);
  if(!u) return;

  u.admin=true;
  u.oldCallsign=u.callsign;
  u.callsign=`CONTROL ${u.oldCallsign}`;
  cb({ok:true});
  broadcastUsers();
 });

 socket.on("leaveAdmin",()=>{
  const u=users.find(x=>x.id===socket.id);
  if(!u) return;
  u.admin=false;
  u.callsign=u.oldCallsign;
  delete u.oldCallsign;
  socket.emit("forceLogout");
 });

 /* ===== CHAT ===== */
 socket.on("chat",d=>{
  const u=users.find(x=>x.id===socket.id);
  if(!u) return;

  if(mutedIPs[ip] && mutedIPs[ip]>Date.now()){
   socket.emit("muted");
   return;
  }

  if(!u.admin && !isNatoOnly(d.text)) return;

  let msg=`${u.callsign}: ${d.text}`;
  if(d.to) msg=`${u.callsign} TO ${d.to}: ${d.text}`;

  io.emit("chat",{text:msg});
 });

 /* ===== ADMIN BROADCAST ===== */
 socket.on("adminBroadcast",d=>{
  const u=users.find(x=>x.id===socket.id);
  if(!u||!u.admin) return;

  io.emit("adminMessage",{text:d.text});
 });

 /* ===== ADMIN DM ===== */
 socket.on("adminDM",d=>{
  const admin=users.find(x=>x.id===socket.id);
  const target=getUserByCallsign(d.to);
  if(!admin||!admin.admin||!target||target.admin) return;

  io.to(target.id).emit("adminDM",{text:d.text});
 });

 /* ===== MUTE ===== */
 socket.on("adminMuteUser",d=>{
  const admin=users.find(x=>x.id===socket.id);
  const target=getUserByCallsign(d.callsign);
  if(!admin||!admin.admin||!target||target.admin) return;

  mutedIPs[target.ip]=Date.now()+d.minutes*60000;
  io.emit("system",{text:`${target.callsign} MUTED FOR ${d.minutes} MINUTES`});
  io.to(target.id).emit("adminDM",{text:`YOU ARE MUTED FOR ${d.minutes} MINUTES`});
 });

 socket.on("adminUnmuteUser",d=>{
  const admin=users.find(x=>x.id===socket.id);
  const target=getUserByCallsign(d.callsign);
  if(!admin||!admin.admin||!target) return;

  delete mutedIPs[target.ip];
  io.to(target.id).emit("unmuted");
 });

 /* ===== FORCE LOGOUT ===== */
 socket.on("adminLogoutUser",d=>{
  const admin=users.find(x=>x.id===socket.id);
  const target=getUserByCallsign(d.callsign);
  if(!admin||!admin.admin||!target) return;

  io.to(target.id).emit("forceLogout");
 });

 socket.on("disconnect",()=>{
  users=users.filter(u=>u.id!==socket.id);
  broadcastUsers();
 });
});

/* ================= START ================= */

server.listen(3000,()=>console.log("SERVER RUNNING :3000"));
