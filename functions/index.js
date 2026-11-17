const {onCall,HttpsError}=require("firebase-functions/v2/https");
const {initializeApp}=require("firebase-admin/app");
const {getDatabase,ServerValue}=require("firebase-admin/database");
const {Chess}=require("chess.js");
initializeApp();
const db=getDatabase();
const cleanCode=v=>String(v||"").trim().toUpperCase();
const validCode=v=>/^[A-Z0-9]{6}$/.test(v);
exports.createRoom=onCall({region:"europe-west1"},async request=>{
 if(!request.auth)throw new HttpsError("unauthenticated","Нужно войти в игру.");
 const code=cleanCode(request.data?.code);
 if(!validCode(code))throw new HttpsError("invalid-argument","Неверный код комнаты.");
 const roomRef=db.ref("rooms/"+code);
 const result=await roomRef.transaction(current=>{
  if(current!==null)return;
  return {fen:new Chess().fen(),turn:"white",status:"waiting",players:{[request.auth.uid]:{color:"white",joinedAt:Date.now()}},moves:[],createdAt:ServerValue.TIMESTAMP,updatedAt:ServerValue.TIMESTAMP};
 },undefined,false);
 if(!result.committed)throw new HttpsError("already-exists","Комната с таким кодом уже существует.");
 return {code,color:"white"};
});
exports.joinRoom=onCall({region:"europe-west1"},async request=>{
 if(!request.auth)throw new HttpsError("unauthenticated","Нужно войти в игру.");
 const code=cleanCode(request.data?.code);
 if(!validCode(code))throw new HttpsError("invalid-argument","Неверный код комнаты.");
 const uid=request.auth.uid,roomRef=db.ref("rooms/"+code);
 let failure=null;
 const result=await roomRef.transaction(room=>{
  if(!room){failure="Комната не найдена.";return;}
  room.players=room.players||{};
  if(room.players[uid])return room;
  if(Object.keys(room.players).length>=2){failure="В комнате уже два игрока.";return;}
  if(room.status==="finished"){failure="Партия уже завершена.";return;}
  room.players[uid]={color:"black",joinedAt:Date.now()};
  room.status="active";room.updatedAt=Date.now();
  return room;
 },undefined,false);
 if(failure)throw new HttpsError("failed-precondition",failure);
 if(!result.committed)throw new HttpsError("aborted","Не удалось войти в комнату.");
 return {code,color:result.snapshot.child("players/"+uid+"/color").val()};
});
exports.makeMove=onCall({region:"europe-west1"},async request=>{
 if(!request.auth)throw new HttpsError("unauthenticated","Нужно войти в игру.");
 const code=cleanCode(request.data?.code),from=String(request.data?.from||""),to=String(request.data?.to||""),promotion=String(request.data?.promotion||"q");
 if(!validCode(code)||!/^[a-h][1-8]$/.test(from)||!/^[a-h][1-8]$/.test(to)||!["q","r","b","n"].includes(promotion))throw new HttpsError("invalid-argument","Некорректный ход.");
 const uid=request.auth.uid,roomRef=db.ref("rooms/"+code);let failure=null;
 const result=await roomRef.transaction(room=>{
  if(!room){failure="Комната не найдена.";return;}
  const player=room.players?.[uid];
  if(!player||Object.keys(room.players||{}).length!==2){failure="Вы не участник активной партии.";return;}
  if(room.status!=="active"){failure="Партия ещё не началась или уже завершена.";return;}
  if(room.turn!==player.color){failure="Сейчас ход соперника.";return;}
  try{
   const game=new Chess(room.fen);
   const move=game.move({from,to,promotion});
   if(!move){failure="Недопустимый ход.";return;}
   room.fen=game.fen();room.turn=game.turn()==="w"?"white":"black";
   room.moves=room.moves||[];room.moves.push({san:move.san,from,to,promotion:move.promotion||null,at:Date.now()});
   room.updatedAt=Date.now();
   if(game.isGameOver()){room.status="finished";room.result=game.isCheckmate()?(game.turn()==="w"?"black":"white"):"draw";}
   return room;
  }catch(e){failure="Недопустимый ход.";return;}
 },undefined,false);
 if(failure)throw new HttpsError("failed-precondition",failure);
 if(!result.committed)throw new HttpsError("aborted","Не удалось сохранить ход.");
 return {fen:result.snapshot.child("fen").val(),status:result.snapshot.child("status").val()};
});