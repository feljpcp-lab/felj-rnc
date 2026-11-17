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
   if(!r.descricao)return reply({error:"A descrição da não conformidade é obrigatória."},400);
   if(!r.emissor)return reply({error:"Informe quem abriu a RNC."},400);
   if(!["SUCATEADO","LIBERADO S/ RETRABALHO","LIBERADO C/ RETRABALHO"].includes(r.disposicao))return reply({error:"Selecione uma disposição válida para a peça."},400);
   if(!["Aberta","Em Andamento","Aguardando Verificação","Concluída"].includes(r.status||"Aberta"))return reply({error:"Status da RNC inválido."},400);
   if(["Aguardando Verificação","Concluída"].includes(r.status)){
    const missing=["porque_1","porque_2","porque_3","porque_4","porque_5","causa_raiz"].filter(k=>!String(r[k]||"").trim());
    const hasPlan=[1,2,3].some(i=>String(r["plano_acao_"+i]||"").trim()&&String(r["prazo_plano_"+i]||"").trim());
    if(missing.length||!hasPlan)return reply({error:"Para avançar para verificação ou concluir, preencha os 5 Porquês, a causa raiz e pelo menos uma ação do plano com prazo."},400);
   }
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
  if(b.action==="delete"){if(!isAdmin)return reply({error:"Somente o administrador pode excluir registros."},403);const q=await db.from("rnc_registros").delete().eq("id",b.id);if(q.error)throw q.error;return reply({data:true});}
  return reply({error:"Ação inválida"},400);
 }catch(e){return reply({error:e?.message||"Erro interno"},500)}
});