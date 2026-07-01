import express from 'express';
import { searchNews, getRbiNews, getLatestNews, getCategories, triggerNewsCrawl, debugNews } from '../controllers/newsController.js';
import { protect, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/search', protect, searchNews);
router.get('/rbi', protect, getRbiNews);
router.get('/latest', protect, getLatestNews);
router.get('/categories', protect, getCategories);

// Admin / Debug endpoints
router.post('/crawl', protect, requireAdmin, triggerNewsCrawl);
router.get('/debug', protect, requireAdmin, debugNews);

export default router;
