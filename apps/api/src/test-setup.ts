process.env.NODE_ENV = "test";
process.env.DATABASE_URL ||= "postgresql://chatind:chatind@localhost:5432/chatind";
process.env.DIRECT_URL ||= process.env.DATABASE_URL;
process.env.JWT_SECRET ||= "unit-test-access-secret-long-enough-123456";
process.env.REFRESH_TOKEN_SECRET ||= "unit-test-refresh-secret-long-enough-123456";
process.env.CORS_ORIGIN ||= "http://localhost:5173";
