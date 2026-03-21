declare module "multer" {
  import { RequestHandler } from "express";

  interface File {
    fieldname: string;
    originalname: string;
    encoding: string;
    mimetype: string;
    size: number;
    destination: string;
    filename: string;
    path: string;
    buffer: Buffer;
  }

  interface Options {
    dest?: string;
    limits?: {
      fileSize?: number;
      files?: number;
      fields?: number;
    };
    fileFilter?: (req: any, file: any, cb: (error: Error | null, acceptFile: boolean) => void) => void;
  }

  interface Multer {
    single(fieldName: string): RequestHandler;
    array(fieldName: string, maxCount?: number): RequestHandler;
    none(): RequestHandler;
  }

  function multer(options?: Options): Multer;
  export = multer;
}

declare namespace Express {
  interface User {
    id: string;
    username: string;
    name: string;
    role: string;
    orgId: string;
    orgSlug?: string;
  }

  interface Request {
    file?: import("multer").File;
    files?: import("multer").File[];
    user?: User;
    orgId?: string;
  }
}

// Extend express-session to include super-admin impersonation flag
declare module "express-session" {
  interface SessionData {
    /** When a super admin is impersonating an org, this holds the target org's ID */
    impersonatingOrgId?: string;
    /** The original org ID before impersonation started */
    originalOrgId?: string;
  }
}
