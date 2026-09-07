import { NextResponse } from "next/server";
import { AppError } from "./index.js";
export function ok(data, status=200) { return NextResponse.json({success:true,data},{status}); }
export function fail(error) { const known=error instanceof AppError; if(!known) console.error(error); return NextResponse.json({success:false,error:{code:known?error.code:"INTERNAL_ERROR",message:known?error.message:"An unexpected error occurred",...(known&&error.details?{details:error.details}:{})}},{status:known?error.statusCode:500}); }
