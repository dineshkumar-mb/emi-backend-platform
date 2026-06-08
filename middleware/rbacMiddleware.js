/**
 * Role-Based Access Control (RBAC) authorization middleware
 * @param {string[]} allowedRoles - List of permitted roles (e.g. ['admin', 'support'])
 */
export const authorize = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'Authorization required: User not logged in.' });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        message: `Forbidden: Access restricted. Required roles: [${allowedRoles.join(', ')}]. Current role: "${req.user.role}".` 
      });
    }

    next();
  };
};
