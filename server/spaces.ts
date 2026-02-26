import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logInfo, logError } from "./logger";

interface SpacesConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
}

let s3Client: S3Client | null = null;
let spacesConfig: SpacesConfig | null = null;

export function isSpacesConfigured(): boolean {
  return !!(
    process.env.DO_SPACES_KEY &&
    process.env.DO_SPACES_SECRET &&
    process.env.DO_SPACES_BUCKET &&
    process.env.DO_SPACES_REGION
  );
}

export function initSpaces(): boolean {
  if (!isSpacesConfigured()) {
    logInfo("DigitalOcean Spaces no configurado - almacenamiento de archivos deshabilitado");
    return false;
  }

  const region = process.env.DO_SPACES_REGION!;
  const endpoint = process.env.DO_SPACES_ENDPOINT || `https://${region}.digitaloceanspaces.com`;

  spacesConfig = {
    endpoint,
    region,
    bucket: process.env.DO_SPACES_BUCKET!,
    accessKeyId: process.env.DO_SPACES_KEY!,
    secretAccessKey: process.env.DO_SPACES_SECRET!,
    publicBaseUrl: process.env.DO_SPACES_PUBLIC_BASE_URL,
  };

  s3Client = new S3Client({
    endpoint: spacesConfig.endpoint,
    region: spacesConfig.region,
    credentials: {
      accessKeyId: spacesConfig.accessKeyId,
      secretAccessKey: spacesConfig.secretAccessKey,
    },
    forcePathStyle: false,
  });

  logInfo("DigitalOcean Spaces inicializado", {
    region: spacesConfig.region,
    bucket: spacesConfig.bucket,
  });

  return true;
}

export async function uploadFile(
  key: string,
  data: Buffer | Uint8Array | string,
  contentType: string = "application/octet-stream",
  isPublic: boolean = false
): Promise<string> {
  if (!s3Client || !spacesConfig) {
    throw new Error("Spaces no está configurado");
  }

  try {
    const command = new PutObjectCommand({
      Bucket: spacesConfig.bucket,
      Key: key,
      Body: data,
      ContentType: contentType,
      ACL: isPublic ? "public-read" : "private",
    });

    await s3Client.send(command);

    logInfo("Archivo subido a Spaces", { key, contentType, isPublic });

    if (isPublic && spacesConfig.publicBaseUrl) {
      return `${spacesConfig.publicBaseUrl}/${key}`;
    }

    return key;
  } catch (error) {
    logError("Error al subir archivo a Spaces", error);
    throw error;
  }
}

export async function uploadSignature(
  punchId: number,
  signatureData: string
): Promise<string> {
  const base64Data = signatureData.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64Data, "base64");
  
  const key = `signatures/${new Date().getFullYear()}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${punchId}.png`;
  
  return uploadFile(key, buffer, "image/png", false);
}

export async function getSignedDownloadUrl(
  key: string,
  expiresIn: number = 3600
): Promise<string> {
  if (!s3Client || !spacesConfig) {
    throw new Error("Spaces no está configurado");
  }

  const command = new GetObjectCommand({
    Bucket: spacesConfig.bucket,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function getSignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 3600
): Promise<string> {
  if (!s3Client || !spacesConfig) {
    throw new Error("Spaces no está configurado");
  }

  const command = new PutObjectCommand({
    Bucket: spacesConfig.bucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
}

export async function deleteFile(key: string): Promise<void> {
  if (!s3Client || !spacesConfig) {
    throw new Error("Spaces no está configurado");
  }

  try {
    const command = new DeleteObjectCommand({
      Bucket: spacesConfig.bucket,
      Key: key,
    });

    await s3Client.send(command);
    logInfo("Archivo eliminado de Spaces", { key });
  } catch (error) {
    logError("Error al eliminar archivo de Spaces", error);
    throw error;
  }
}

export async function fileExists(key: string): Promise<boolean> {
  if (!s3Client || !spacesConfig) {
    return false;
  }

  try {
    const command = new HeadObjectCommand({
      Bucket: spacesConfig.bucket,
      Key: key,
    });

    await s3Client.send(command);
    return true;
  } catch {
    return false;
  }
}

export function getPublicUrl(key: string): string | null {
  if (!spacesConfig?.publicBaseUrl) {
    return null;
  }
  return `${spacesConfig.publicBaseUrl}/${key}`;
}
