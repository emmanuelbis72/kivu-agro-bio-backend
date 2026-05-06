function parseBooleanFlag(value) {
  if (value == null) {
    return null;
  }

  const normalized = String(value).trim().toLowerCase();

  if (["1", "true", "yes", "on", "require", "required"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off", "disable", "disabled"].includes(normalized)) {
    return false;
  }

  return null;
}

function isLocalHostname(hostname) {
  return ["localhost", "127.0.0.1", "::1"].includes(hostname);
}

function shouldUseSSL(connectionString) {
  const explicitSSL =
    parseBooleanFlag(process.env.DATABASE_SSL) ??
    parseBooleanFlag(process.env.PGSSLMODE);

  if (explicitSSL !== null) {
    return explicitSSL;
  }

  if (process.env.NODE_ENV === "production") {
    return true;
  }

  try {
    const url = new URL(connectionString);
    const hostname = String(url.hostname || "").trim().toLowerCase();
    const sslMode = String(url.searchParams.get("sslmode") || "")
      .trim()
      .toLowerCase();

    if (["require", "verify-ca", "verify-full"].includes(sslMode)) {
      return true;
    }

    if (!hostname || isLocalHostname(hostname)) {
      return false;
    }

    return hostname.includes("render.com");
  } catch {
    return false;
  }
}

export function buildPgPoolConfig(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) {
    throw new Error("DATABASE_URL manquant dans les variables d'environnement.");
  }

  return {
    connectionString,
    ssl: shouldUseSSL(connectionString) ? { rejectUnauthorized: false } : false
  };
}
