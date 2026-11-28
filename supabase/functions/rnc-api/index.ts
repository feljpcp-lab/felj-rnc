import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:cors});
async function hash(s:string){const b=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s));return Array.from(new Uint8Array(b)).map(x=>x.toString(16).padStart(2,"0")).join("");}
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response("ok",{headers:cors});
 if(req.method!=="POST")return reply({error:"Método não permitido"},405);
 try{
  const b=await req.json();
  const db=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if(b.action==="sendReminders"){
   const cronCfg=await db.from("rnc_cron_config").select("token_hash").eq("id",1).single();
   const cronToken=req.headers.get("x-rnc-cron-token")||"";
   if(cronCfg.error||!cronCfg.data||await hash(cronToken)!==cronCfg.data.token_hash)return reply({error:"Token de agendamento inválido."},401);
   const resendKey=Deno.env.get("RESEND_API_KEY");
   if(!resendKey)return reply({error:"RESEND_API_KEY não está configurada no Supabase."},503);
   const dateParts=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
   const dateMap=Object.fromEntries(dateParts.map(p=>[p.type,p.value]));
   const today=dateMap.year+"-"+dateMap.month+"-"+dateMap.day;
   const [year,month,day]=today.split("-").map(Number);
   const horizon=new Date(Date.UTC(year,month-1,day+3)).toISOString().slice(0,10);
   const records=await db.from("rnc_registros").select("id,numero,numero_os,cliente,status,emissor,setor_responsavel,acao_corretiva_1,prazo_corretiva_1,acao_corretiva_2,prazo_corretiva_2,acao_corretiva_3,prazo_corretiva_3,plano_acao_1,prazo_plano_1,plano_acao_2,prazo_plano_2,plano_acao_3,prazo_plano_3").in("status",["Aberta","Em Andamento","Aguardando Verificação"]).limit(500);
   if(records.error)throw records.error;
   const ids=(records.data||[]).map((r:any)=>r.id);
   const actions=ids.length?await db.from("rnc_acoes").select("rnc_id,tipo,descricao,responsavel,prazo,status").in("rnc_id",ids).in("status",["Pendente","Em andamento"]):{data:[],error:null};
   if(actions.error)throw actions.error;
   const alerts:any[]=[];
   const add=(r:any,type:string,description:string,due:any,responsible:string|null)=>{
    const date=String(due||"").slice(0,10);
    if(description&&date&&date<=horizon)alerts.push({numero:r.numero,os:r.numero_os,cliente:r.cliente,status:r.status,type,description,responsible,due:date,overdue:date<today});
   };
   for(const r of (records.data||[])){
    for(let i=1;i<=3;i++){
     add(r,"Ação corretiva",r["acao_corretiva_"+i],r["prazo_corretiva_"+i],r.setor_responsavel||null);
     add(r,"Plano de ação",r["plano_acao_"+i],r["prazo_plano_"+i],r.setor_responsavel||null);
    }
   }
   const byId=new Map((records.data||[]).map((r:any)=>[r.id,r]));
   for(const a of (actions.data||[])){const r=byId.get(a.rnc_id);if(r)add(r,a.tipo+" (ação)",a.descricao,a.prazo,a.responsavel);}
   if(!alerts.length)return reply({ok:true,sent:false,count:0,message:"Nenhuma ação vencida ou com vencimento nos próximos 3 dias."});
   const lines=alerts.map(a=>"RNC "+(a.numero||"—")+" · OS "+(a.os||"—")+" · "+(a.cliente||"Cliente não informado")+"\n"+(a.overdue?"VENCIDA":"VENCE EM BREVE")+" — "+a.type+": "+a.description+"\nResponsável: "+(a.responsible||"Não definido")+" · Prazo: "+a.due+" · Status RNC: "+a.status);
   const mailFrom=Deno.env.get("MAIL_FROM")||"FELJ Teste <onboarding@resend.dev>";
   const er=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+resendKey,"Content-Type":"application/json"},body:JSON.stringify({from:mailFrom,to:["pcp@felj.com.br"],subject:"FELJ | Alertas de prazo de RNC",text:"Atenção: existem ações vencidas ou com vencimento nos próximos 3 dias.\n\n"+lines.join("\n\n")})});
   const ej=await er.json().catch(()=>({}));
   if(!er.ok)return reply({error:"Falha ao enviar o resumo de prazos.",detail:ej?.message||"Verifique o remetente configurado."},502);
   return reply({ok:true,sent:true,count:alerts.length,recipient:"pcp@felj.com.br",id:ej?.id||null});
  }
  const cfg=await db.from("rnc_access_config").select("team_pin_hash,admin_pin_hash").eq("id",1).single();
  if(cfg.error||!cfg.data)return reply({error:"Configuração de acesso indisponível"},503);
  if(typeof b.pin!=="string"||await hash(b.pin)!==cfg.data.team_pin_hash)return reply({error:"Código de acesso inválido"},401);
  const isAdmin=typeof b.adminPin==="string"&&await hash(b.adminPin)===cfg.data.admin_pin_hash;
  if(b.action==="adminUnlock")return isAdmin?reply({ok:true}):reply({error:"Código de administrador inválido"},401);
  if(b.action==="testEmail"){
   if(!isAdmin)return reply({error:"Somente o administrador pode testar o e-mail."},403);
   const resendKey=Deno.env.get("RESEND_API_KEY");
   const mailFrom=Deno.env.get("MAIL_FROM")||"FELJ Teste <onboarding@resend.dev>";
   if(!resendKey)return reply({error:"RESEND_API_KEY não está configurada no Supabase."},503);
   const er=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+resendKey,"Content-Type":"application/json"},body:JSON.stringify({from:mailFrom,to:["feljpcp@gmail.com"],subject:"FELJ | Teste de notificação de RNC",text:"Este é um e-mail de teste do sistema de RNC da FELJ. Se você recebeu esta mensagem, a integração com o Resend está funcionando.\n\nDestino de produção: pcp@felj.com.br."})});
   const ej=await er.json().catch(()=>({}));
   if(!er.ok)return reply({error:"O Resend recusou o teste.",detail:ej?.message||"Verifique a chave e o remetente configurado."},502);
   return reply({ok:true,message:"Solicitação aceita pelo Resend",id:ej?.id||null,recipient:"feljpcp@gmail.com"});
  }
  if(b.action==="list"){
   const q=await db.from("rnc_registros").select("*").order("created_at",{ascending:false}).limit(500);if(q.error)throw q.error;
   let data=q.data||[];if(data.length){const aq=await db.from("rnc_acoes").select("id,rnc_id,tipo,descricao,responsavel,prazo,status,concluida_em").in("rnc_id",data.map((x:any)=>x.id));if(aq.error)throw aq.error;const grouped=new Map<string,any[]>();for(const a of (aq.data||[])){const arr=grouped.get(a.rnc_id)||[];arr.push(a);grouped.set(a.rnc_id,arr)}data=data.map((x:any)=>({...x,acoes:grouped.get(x.id)||[]}));}if(b.status)data=data.filter((x:any)=>x.status===b.status);if(b.category)data=data.filter((x:any)=>x.categoria===b.category);
   if(b.search){const s=String(b.search).toLowerCase();data=data.filter((x:any)=>[x.numero,x.id,x.numero_os,x.cliente,x.componente,x.categoria,x.descricao,x.codigo_desenho_peca_lote].some(v=>String(v||"").toLowerCase().includes(s)));}
   return reply({data});
  }
  if(b.action==="actionsList"){
   if(!b.rncId)return reply({error:"RNC não informada."},400);
   const q=await db.from("rnc_acoes").select("*").eq("rnc_id",b.rncId).order("criado_em",{ascending:true});
   if(q.error)throw q.error; return reply({data:q.data||[]});
  }
  if(b.action==="actionSave"){
   const a={...(b.actionRecord||{})}; const id=a.id;
   delete a.id;delete a.criado_em;delete a.atualizado_em;delete a.rnc_id;delete a.concluida_em;
   if(!b.rncId)return reply({error:"RNC não informada."},400);
   const descricao=String(a.descricao||"").trim(),responsavel=String(a.responsavel||"").trim();
   if(!descricao)return reply({error:"Descreva a ação."},400);
   if(!responsavel)return reply({error:"Informe o responsável pela ação."},400);
   if(!a.prazo)return reply({error:"Informe o prazo da ação."},400);
   if(!["Corretiva","Preventiva"].includes(a.tipo))return reply({error:"Tipo de ação inválido."},400);
   if(!["Pendente","Em andamento","Concluída","Cancelada"].includes(a.status))return reply({error:"Status de ação inválido."},400);
   if(a.status==="Concluída"&&!String(a.evidencia||"").trim())return reply({error:"Registre a evidência antes de concluir a ação."},400);
   const parent=await db.from("rnc_registros").select("id,status").eq("id",b.rncId).single();
   if(parent.error||!parent.data)return reply({error:"RNC não encontrada."},404);
   const payload={...a,rnc_id:b.rncId,descricao,responsavel};
   const q=id?await db.from("rnc_acoes").update(payload).eq("id",id).eq("rnc_id",b.rncId).select().single():await db.from("rnc_acoes").insert(payload).select().single();
   if(q.error)throw q.error;
   if(["Concluída","Aguardando Verificação"].includes(parent.data.status)&&!["Concluída","Cancelada"].includes(a.status)){
    const reopen=await db.from("rnc_registros").update({status:"Em Andamento",updated_at:new Date().toISOString()}).eq("id",b.rncId);
    if(reopen.error)throw reopen.error;
   }
   return reply({data:q.data});
  }
  if(b.action==="actionDelete"){
   if(!isAdmin)return reply({error:"Somente o administrador pode remover ações."},403);
   if(!b.id)return reply({error:"Ação não informada."},400);
   const q=await db.from("rnc_acoes").delete().eq("id",b.id);if(q.error)throw q.error;return reply({data:true});
  }
  if(b.action==="attachmentsList"){
   if(!b.rncId)return reply({error:"RNC não informada."},400);
   const q=await db.from("rnc_anexos").select("*").eq("rnc_id",b.rncId).order("criado_em",{ascending:false});
   if(q.error)throw q.error;
   const data=await Promise.all((q.data||[]).map(async(a:any)=>{
    const signed=await db.storage.from("rnc-anexos").createSignedUrl(a.storage_path,3600);
    return {...a,signed_url:signed.data?.signedUrl||null};
   }));
   return reply({data});
  }
  if(b.action==="uploadAttachment"){
   if(!b.rncId)return reply({error:"RNC não informada."},400);
   const allowed=["image/jpeg","image/png","image/webp","application/pdf"];
   const contentType=String(b.contentType||"").toLowerCase();
   if(!allowed.includes(contentType))return reply({error:"Formato não permitido. Envie JPG, PNG, WEBP ou PDF."},400);
   const encoded=String(b.fileBase64||"").replace(/^data:[^,]+,/, "");
   if(!encoded||encoded.length>11200000)return reply({error:"Arquivo vazio ou maior que o limite de 8 MB."},413);
   let bytes:Uint8Array;
   try{const binary=atob(encoded);bytes=Uint8Array.from(binary,(c)=>c.charCodeAt(0));}catch{return reply({error:"Não foi possível ler o arquivo enviado."},400);}
   if(bytes.length===0||bytes.length>8388608)return reply({error:"Cada anexo deve ter no máximo 8 MB."},413);
   const parent=await db.from("rnc_registros").select("id").eq("id",b.rncId).single();
   if(parent.error||!parent.data)return reply({error:"RNC não encontrada. Salve a RNC antes de anexar arquivos."},404);
   const original=String(b.fileName||"anexo").split(/[\\/]/).pop()||"anexo";
   const safeName=original.normalize("NFKC").replace(/[^\\p{L}\\p{N}._-]+/gu,"_").slice(0,120)||"anexo";
   const storagePath=b.rncId+"/"+crypto.randomUUID()+"_"+safeName;
   const upload=await db.storage.from("rnc-anexos").upload(storagePath,bytes,{contentType,upsert:false,cacheControl:"3600"});
   if(upload.error)throw upload.error;
   const saved=await db.from("rnc_anexos").insert({rnc_id:b.rncId,nome_arquivo:safeName,content_type:contentType,tamanho_bytes:bytes.length,storage_path:storagePath,enviado_por:String(b.uploadedBy||"").trim().slice(0,120)||null}).select().single();
   if(saved.error){await db.storage.from("rnc-anexos").remove([storagePath]);throw saved.error;}
   const signed=await db.storage.from("rnc-anexos").createSignedUrl(storagePath,3600);
   return reply({data:{...saved.data,signed_url:signed.data?.signedUrl||null}});
  }
  if(b.action==="attachmentDelete"){
   if(!isAdmin)return reply({error:"Somente o administrador pode remover anexos."},403);
   if(!b.id)return reply({error:"Anexo não informado."},400);
   const item=await db.from("rnc_anexos").select("id,storage_path").eq("id",b.id).single();
   if(item.error||!item.data)return reply({error:"Anexo não encontrado."},404);
   const removed=await db.storage.from("rnc-anexos").remove([item.data.storage_path]);
   if(removed.error)throw removed.error;
   const deleted=await db.from("rnc_anexos").delete().eq("id",b.id);
   if(deleted.error)throw deleted.error;
   return reply({data:true});
  }
  if(b.action==="history"){
   if(!b.rncId)return reply({error:"RNC não informada."},400);
   const q=await db.from("rnc_historico").select("*").eq("rnc_id",b.rncId).order("ocorrido_em",{ascending:false}).limit(100);
   if(q.error)throw q.error;return reply({data:q.data||[]});
  }
  if(b.action==="save"){
   const r={...(b.record||{})};delete r.numero;delete r.criado_em;delete r.atualizado_em;delete r.data_ocorrencia;delete r.id;delete r.created_at;delete r.updated_at;delete r.created_by;delete r.updated_by;
   r.descricao=String(r.descricao||"").trim();
   r.emissor=String(r.emissor||"").trim();
   r.disposicao=String(r.disposicao||"").trim();
   r.acao_corretiva_1=String(r.acao_corretiva_1||"").trim();
   r.cliente=String(r.cliente||"").trim();
   r.componente=String(r.componente||"").trim();
   r.setor_encontrou=String(r.setor_encontrou||"").trim();
   if(!r.descricao)return reply({error:"A descrição da não conformidade é obrigatória."},400);
   if(!r.acao_corretiva_1)return reply({error:"Informe a ação corretiva para salvar a RNC."},400);
   if(!r.emissor)return reply({error:"Informe quem abriu a RNC."},400);
   if(!r.cliente)return reply({error:"Informe o cliente."},400);
   if(!r.componente)return reply({error:"Selecione o componente."},400);
   if(!r.setor_encontrou)return reply({error:"Informe o setor que encontrou o problema."},400);
   if(!["SUCATEADO","LIBERADO S/ RETRABALHO","LIBERADO C/ RETRABALHO"].includes(r.disposicao))return reply({error:"Selecione uma disposição válida para a peça."},400);
   if(!["Aberta","Em Andamento","Aguardando Verificação","Concluída"].includes(r.status||"Aberta"))return reply({error:"Status da RNC inválido."},400);
      if(["Aguardando Verificação","Concluída"].includes(r.status)&&b.id){
    const pending=await db.from("rnc_acoes").select("id,status").eq("rnc_id",b.id).in("status",["Pendente","Em andamento"]);
    if(pending.error)throw pending.error;
    if((pending.data||[]).length)return reply({error:"Não é possível avançar a RNC enquanto houver ações pendentes ou em andamento. Conclua ou cancele todas as ações primeiro."},409);
   }
   if(r.status==="Concluída"&&(!r.acao_eficaz||!r.data_encerramento||!String(r.responsavel_encerramento||"").trim()))return reply({error:"Para concluir, informe a eficácia, a data e o responsável pelo encerramento."},400);
   if(!isAdmin)delete r.custo_estimado;
   let q;if(b.id)q=await db.from("rnc_registros").update({...r,updated_at:new Date().toISOString()}).eq("id",b.id).select().single();else q=await db.from("rnc_registros").insert(r).select().single();
   if(q.error)throw q.error;
   let notification={sent:false,reason:"Configuração de e-mail não disponível"};
   if(!b.id){
    const resendKey=Deno.env.get("RESEND_API_KEY"),mailFrom=Deno.env.get("MAIL_FROM");
    if(resendKey&&mailFrom){try{
     const details=[["RNC",q.data.numero||q.data.id],["OS",q.data.numero_os],["Cliente",q.data.cliente],["Componente",q.data.componente],["Categoria",q.data.categoria],["Descrição",q.data.descricao],["Emissor",q.data.emissor],["Data",q.data.data_registro]].filter(([,v])=>v!==null&&v!==undefined&&String(v).trim()).map(([k,v])=>k+": "+String(v).slice(0,1500)).join("\n");
     const er=await fetch("https://api.resend.com/emails",{method:"POST",headers:{"Authorization":"Bearer "+resendKey,"Content-Type":"application/json"},body:JSON.stringify({from:mailFrom,to:["pcp@felj.com.br"],subject:"FELJ | Nova RNC cadastrada",text:"Uma nova RNC foi cadastrada no sistema FELJ.\n\n"+details})});
     await er.json().catch(()=>({}));notification=er.ok?{sent:true}:{sent:false,reason:"Falha no provedor de e-mail"};
    }catch{notification={sent:false,reason:"Falha no envio de e-mail"}}}
   }
   return reply({data:q.data,notification});
  }
  if(b.action==="delete"){
   if(!isAdmin)return reply({error:"Somente o administrador pode excluir registros."},403);
   if(!b.id)return reply({error:"RNC não informada."},400);
   const attachments=await db.from("rnc_anexos").select("storage_path").eq("rnc_id",b.id);
   if(attachments.error)throw attachments.error;
   if((attachments.data||[]).length){const removed=await db.storage.from("rnc-anexos").remove(attachments.data.map((a:any)=>a.storage_path));if(removed.error)throw removed.error;}
   const q=await db.from("rnc_registros").delete().eq("id",b.id);if(q.error)throw q.error;return reply({data:true});
  }
  return reply({error:"Ação inválida"},400);
 }catch(e){return reply({error:e?.message||"Erro interno"},500)}
});