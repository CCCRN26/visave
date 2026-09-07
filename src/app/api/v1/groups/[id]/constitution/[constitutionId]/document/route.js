import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { fail, ok } from "@/lib/errors/response";
import { uploadConstitutionDocument, downloadConstitutionDocument } from "@/modules/onboarding/constitution-document.service";

export async function POST(request,{params}){try{const{id,constitutionId}=await params,user=await requireAuth();await requireGroupRouteAction(user,id,"constitution.manage",GROUP_ACTION.CONSTITUTION_MANAGE);const form=await request.formData(),file=form.get("file"),reason=String(form.get("reason")||"");return ok(await uploadConstitutionDocument(id,constitutionId,file,reason,user),201)}catch(error){return fail(error)}}
export async function GET(_request,{params}){try{const{id,constitutionId}=await params,user=await requireAuth();await requireGroupRouteAction(user,id,"constitution.view",GROUP_ACTION.CONSTITUTION_VIEW);const{document,bytes}=await downloadConstitutionDocument(id,constitutionId,user),filename=String(document.original_filename||"constitution.pdf").replace(/[^A-Za-z0-9._ -]/g,"_");return new Response(bytes,{status:200,headers:{"Content-Type":"application/pdf","Content-Disposition":`attachment; filename="${filename}"`,"X-Content-Type-Options":"nosniff","Cache-Control":"private, no-store"}})}catch(error){return fail(error)}}
