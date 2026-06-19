import jwt from 'jsonwebtoken';

const protect = (req, res, next) => {
  let token;

  // Check for Token in headers
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    try {
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'qtutors_super_secret_key_change_me');

      // Attach admin data to req
      req.admin = {
        id: decoded.id,
        username: decoded.username,
      };

      next();
    } catch (error) {
      console.error('❌ Token verification failed:', error.message);
      return res.status(401).json({
        success: false,
        error: 'Not authorized',
        details: 'Token verification failed or expired',
      });
    }
  }

  if (!token) {
    return res.status(401).json({
      success: false,
      error: 'Not authorized',
      details: 'No token provided',
    });
  }
};

export default protect;
