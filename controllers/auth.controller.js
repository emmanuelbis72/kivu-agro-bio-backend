import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import {
  countUsers,
  createUser,
  getUserByEmail
} from "../models/user.model.js";
import { normalizeRole } from "../middlewares/auth.middleware.js";
import { safeRecordAuditEvent } from "../services/audit.service.js";

const ALLOWED_ROLES = [
  "director_general",
  "general_manager",
  "ceo",
  "admin",
  "accountant",
  "commercial_manager",
  "sales_manager",
  "stock_manager",
  "production_manager",
  "staff"
];

function validatePassword(password) {
  return (
    typeof password === "string" &&
    password.length >= 10 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /\d/.test(password)
  );
}

function issueToken(user) {
  const secret = String(process.env.JWT_SECRET || "").trim();

  if (!secret) {
    const error = new Error("JWT_SECRET n'est pas configure.");
    error.statusCode = 500;
    throw error;
  }

  return jwt.sign(
    {
      role: user.role,
      email: user.email,
      name: user.full_name
    },
    secret,
    {
      subject: String(user.id),
      expiresIn: process.env.JWT_EXPIRES_IN || "7d"
    }
  );
}

export async function bootstrapAdminHandler(req, res, next) {
  try {
    const expectedToken = String(process.env.AUTH_BOOTSTRAP_TOKEN || "").trim();
    const providedToken = String(
      req.headers["x-bootstrap-token"] || req.body?.bootstrap_token || ""
    ).trim();

    if (!expectedToken || providedToken !== expectedToken) {
      return res.status(403).json({
        success: false,
        message:
          "Initialisation refusee. Configurez AUTH_BOOTSTRAP_TOKEN puis fournissez-le dans x-bootstrap-token."
      });
    }

    if ((await countUsers()) > 0) {
      return res.status(409).json({
        success: false,
        message: "L'initialisation est deja terminee."
      });
    }

    const fullName = String(req.body?.full_name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const role = normalizeRole(req.body?.role || "director_general");

    if (!fullName || !email || !validatePassword(password)) {
      return res.status(400).json({
        success: false,
        message:
          "Nom, e-mail et mot de passe fort sont requis. Le mot de passe doit contenir au moins 10 caracteres, une majuscule, une minuscule et un chiffre."
      });
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Role utilisateur invalide."
      });
    }

    const user = await createUser({
      full_name: fullName,
      email,
      password_hash: await bcrypt.hash(password, 12),
      role
    });

    await safeRecordAuditEvent({
      req,
      actor: user,
      module: "users",
      action_type: "create",
      entity_type: "user",
      entity_id: user.id,
      new_value: user,
      reason: "Initialisation du premier administrateur",
      risk_level: "high"
    });

    return res.status(201).json({
      success: true,
      message: "Premier compte administrateur cree.",
      data: {
        user,
        token: issueToken(user)
      }
    });
  } catch (error) {
    next(error);
  }
}

export async function loginHandler(req, res, next) {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const user = await getUserByEmail(email);

    if (!user || !user.is_active || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({
        success: false,
        message: "Identifiants invalides."
      });
    }

    const safeUser = {
      id: user.id,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
      is_active: user.is_active
    };

    await safeRecordAuditEvent({
      req,
      actor: safeUser,
      module: "authentication",
      action_type: "validate",
      entity_type: "session",
      entity_id: user.id,
      new_value: { authenticated: true },
      reason: "Connexion utilisateur",
      risk_level: "low"
    });

    return res.status(200).json({
      success: true,
      data: {
        user: safeUser,
        token: issueToken(safeUser)
      }
    });
  } catch (error) {
    next(error);
  }
}

export function meHandler(req, res) {
  return res.status(200).json({
    success: true,
    data: req.user
  });
}
