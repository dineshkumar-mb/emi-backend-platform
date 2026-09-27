import express from 'express';
import { 
  searchNews, 
  getRbiNews, 
  getLatestNews, 
  getCategories, 
  getRepoRateOverview,
  triggerNewsCrawl, 
  debugNews 
} from '../controllers/newsController.js';
import { protect, requireAdmin } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/latest', protect, getLatestNews);
router.get('/rbi', protect, getRbiNews);
router.get('/repo-rate', protect, getRepoRateOverview);
router.get('/categories', protect, getCategories);
router.get('/search', protect, searchNews);

// Crawl trigger (allows authenticated users to request a fresh refresh)
router.post('/crawl', protect, triggerNewsCrawl);
router.get('/debug', protect, requireAdmin, debugNews);

export default router;
