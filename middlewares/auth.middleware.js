import jwt from "jsonwebtoken";
import { getUserById } from "../models/user.model.js";

export const ROLE_GROUPS = {
  executive: ["director_general", "general_manager", "ceo", "admin"],
  finance: ["director_general", "general_manager", "ceo", "admin", "accountant"],
  commercial: [
    "director_general",
    "general_manager",
    "ceo",
    "admin",
    "commercial_manager",
    "sales_manager"
  ],
  operations: [
    "director_general",
    "general_manager",
    "ceo",
    "admin",
    "stock_manager",
    "production_manager"
  ],
  administrator: ["admin"]
};

function getBearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function normalizeRole(role) {
  return String(role || "staff").trim().toLowerCase();
}

export function hasAnyRole(user, roles = []) {
  const userRole = normalizeRole(user?.role);
  return roles.map(normalizeRole).includes(userRole);
}

export function resolveAuthEnforcementMode(value = process.env.AUTH_ENFORCEMENT_MODE) {
  return String(value || "transition").trim().toLowerCase() === "strict"
    ? "strict"
    : "transition";
}

export async function optionalAuthenticate(req, res, next) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      req.user = null;
      return next();
    }

    const secret = String(process.env.JWT_SECRET || "").trim();

    if (!secret) {
      const error = new Error("JWT_SECRET n'est pas configure.");
      error.statusCode = 500;
      throw error;
    }

    const payload = jwt.verify(token, secret);
    const user = await getUserById(Number(payload.sub));

    if (!user || !user.is_active) {
      return res.status(401).json({
        success: false,
        message: "Session invalide ou utilisateur inactif."
      });
    }

    req.user = user;
    return next();
  } catch (error) {
    if (
      error?.name === "JsonWebTokenError" ||
      error?.name === "TokenExpiredError"
    ) {
      return res.status(401).json({
        success: false,
        message: "Jeton d'authentification invalide ou expire."
      });
    }

    return next(error);
  }
}

export function requireAuthentication(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: "Authentification requise."
    });
  }

  return next();
}

export function requireRoles(...roles) {
  return function roleAuthorization(req, res, next) {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentification requise."
      });
    }

    if (!hasAnyRole(req.user, roles)) {
      return res.status(403).json({
        success: false,
        message: "Vous n'avez pas les droits requis pour cette operation."
      });
    }

    return next();
  };
}

export function requireConfiguredAuthentication(req, res, next) {
  const configured = resolveAuthEnforcementMode();

  if (configured === "strict") {
    return requireAuthentication(req, res, next);
  }

  return next();
}

export function requireConfiguredRoles(...roles) {
  return function configuredRoleAuthorization(req, res, next) {
    const configured = resolveAuthEnforcementMode();

    if (configured === "strict") {
      return requireRoles(...roles)(req, res, next);
    }

    return next();
  };
}
