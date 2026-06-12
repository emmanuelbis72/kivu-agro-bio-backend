import { listAuditLogs } from "../models/auditLog.model.js";

export async function listAuditLogsHandler(req, res, next) {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));
    const offset = Math.max(0, Number(req.query.offset || 0));
    const rows = await listAuditLogs({
      start_date: req.query.start_date || null,
      end_date: req.query.end_date || null,
      user_id: req.query.user_id ? Number(req.query.user_id) : null,
      module: req.query.module || null,
      action_type: req.query.action_type || null,
      risk_level: req.query.risk_level || null,
      entity_type: req.query.entity_type || null,
      limit,
      offset
    });

    return res.status(200).json({
      success: true,
      count: rows.length,
      pagination: { limit, offset },
      data: rows
    });
  } catch (error) {
    next(error);
  }
}
