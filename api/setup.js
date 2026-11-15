import { tg } from '../lib/telegram.js';
export default async function handler(req,res){
 if(req.method!=='POST'){res.status(405).json({ok:false,method:'POST required'});return;}
 if(!process.env.SETUP_SECRET||req.headers['x-setup-secret']!==process.env.SETUP_SECRET){res.status(401).json({ok:false});return;}
 const base=String(process.env.PUBLIC_BASE_URL||'').replace(/\/$/,'');
 if(!base||!process.env.WEBHOOK_SECRET){res.status(400).json({ok:false,error:'PUBLIC_BASE_URL and WEBHOOK_SECRET are required'});return;}
 try{const result=await tg('setWebhook',{url:`${base}/api/webhook`,secret_token:process.env.WEBHOOK_SECRET,allowed_updates:['message','callback_query'],drop_pending_updates:false});res.status(200).json({ok:true,result,webhook:`${base}/api/webhook`});}
 catch(e){console.error(e);res.status(500).json({ok:false,error:e.message});}
}
