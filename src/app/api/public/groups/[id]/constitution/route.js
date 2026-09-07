import { downloadPublicConstitution } from '@/modules/public/public.service';
import { fail } from '@/lib/errors/response';

export async function GET(_request,{params}) {
  try {
    const {id}=await params;
    const {filename,bytes}=await downloadPublicConstitution(id);
    const safeFilename=String(filename||'constitution.pdf').replace(/[^A-Za-z0-9._ -]/g,'_');
    return new Response(bytes,{status:200,headers:{'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${safeFilename}"`,'X-Content-Type-Options':'nosniff','Cache-Control':'private, no-store'}});
  } catch(error) { return fail(error); }
}
