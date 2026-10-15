// Test without hardware: node tools/simulate-scale.js [host] [port]
const net=require('node:net');
const host=process.argv[2] || '127.0.0.1';
const port=Number(process.argv[3] || 55555);
const sock=net.connect(port,host,()=>{
 console.log(`Connected to ${host}:${port}`);
 const frames=['US,NT,    2.430kg\r\n','ST,NT,    2.450kg\r\n','ST,NT,    2.450kg\r\n','ST,NT,    0.000kg\r\n','ST,NT,    3.200kg\r\n'];
 let i=0;
 const timer=setInterval(()=>{if(i===frames.length){clearInterval(timer);sock.end();return;} sock.write(frames[i]);console.log('sent',frames[i].trim());i++;},1100);
});
sock.on('error',console.error);
