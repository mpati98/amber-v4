import { SignJWT, jwtVerify } from "jose";

const secret = new TextEncoder().encode(process.env.MOBILE_JWT_SECRET!);
const issuer = "amber-v4";
const audience = "music-stream";

export async function signMusicStreamToken(userId: string, trackId: string): Promise<string> {
  return new SignJWT({ trackId, purpose: "music-stream" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

export async function verifyMusicStreamToken(
  token: string,
): Promise<{ userId: string; trackId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ["HS256"],
      issuer,
      audience,
    });
    if (payload.purpose !== "music-stream" || typeof payload.sub !== "string" || typeof payload.trackId !== "string") {
      return null;
    }
    return { userId: payload.sub, trackId: payload.trackId };
  } catch {
    return null;
  }
}
