import FinancialNews from '../models/FinancialNews.js';
import { chromaService } from '../services/chromaClient.js';
import { getEmbedding } from '../services/ragService.js';
import { queueNewsCrawl } from '../services/newsScheduler.js';
import { newsCollectorAgent } from '../services/agents/newsCollectorAgent.js';

const SEED_NEWS_DATA = [
  {
    title: 'RBI Monetary Policy: Repo Rate Kept Unchanged at 6.50% to Balance Growth and Inflation',
    source: 'RBI',
    url: 'https://www.rbi.org.in/scripts/BS_PressReleaseDisplay.aspx?prid=57001',
    category: 'Repo Rate',
    summary: 'The Reserve Bank of India Monetary Policy Committee (MPC) decided by a majority to keep the policy repo rate unchanged at 6.50 per cent. Consequently, the standing deposit facility (SDF) rate remains at 6.25 per cent and the marginal standing facility (MSF) rate and Bank Rate at 6.75 per cent.',
    content: 'The Reserve Bank of India Monetary Policy Committee has maintained status quo on policy repo rate at 6.50%. The committee noted that domestic economic activity remains resilient, while consumer price inflation headline is gradually aligning with the 4% target. Under the external benchmark framework, all floating retail home and auto loans linked directly to the repo rate will see stable EMIs for this quarter.',
    borrowerImpact: 'Home loan borrowers with floating interest rates (EBLR) will experience stability in their monthly EMI and tenure for the upcoming quarter.',
    importanceScore: 10,
    keywords: ['Repo Rate', 'RBI', 'Monetary Policy', 'Home Loan', 'EBLR', 'Inflation'],
    repoRateMentioned: true,
    currentRepoRate: '6.50%',
    publishedDate: new Date(Date.now() - 2 * 3600 * 1000)
  },
  {
    title: 'How RBI Repo Rate Affects Your Home Loan EMI: Floating Rate vs Fixed Rate Explained',
    source: 'Economic Times',
    url: 'https://economictimes.indiatimes.com/wealth/borrow/rbi-repo-rate-home-loan-emi-impact/articleshow/9981245.cms',
    category: 'Home Loan',
    summary: 'Commercial banks in India link retail loans directly to the RBI Repo Rate through External Benchmark Lending Rates (EBLR). For a ₹50 lakh home loan with a 20-year tenure, every 25 bps change in the repo rate alters the monthly EMI by approximately ₹750 to ₹900.',
    content: 'Since October 2019, the Reserve Bank of India has mandated commercial lenders to peg all floating personal, retail, and MSME loans against an external benchmark. Over 85% of floating home loans are pegged directly to the RBI policy repo rate. When the repo rate holds steady at 6.50%, borrowers benefit from predictability, while any rate cuts by RBI automatically transmit to borrowers within 90 days.',
    borrowerImpact: 'High relevance: Every 0.25% shift in repo rate translates to ~₹15-18 per lakh in monthly payment variations on a 20-year home loan.',
    importanceScore: 9,
    keywords: ['Home Loan', 'EMI Calculator', 'EBLR', 'Banks', 'Floating Rate'],
    repoRateMentioned: true,
    currentRepoRate: '6.50%',
    publishedDate: new Date(Date.now() - 6 * 3600 * 1000)
  },
  {
    title: 'Top Lenders Adjust Marginal Cost of Funds (MCLR) and Spread: What Borrowers Must Know',
    source: 'Moneycontrol',
    url: 'https://www.moneycontrol.com/news/business/personal-finance/banks-mclr-eblr-rates-home-loan-12345.html',
    category: 'Banking',
    summary: 'State Bank of India, HDFC Bank, and ICICI Bank have updated their lending rate spreads. Existing borrowers on older MCLR or Base Rate regimes are advised to consider switching to repo-linked EBLR to gain faster transmission and lower interest rate transparency.',
    content: 'Banking regulators continue to encourage consumers with older loans taken before 2019 to transition to repo rate-linked lending benchmarks. The transition ensures immediate rate relief when monetary easing cycles begin. Borrowers can switch by paying a nominal administrative fee at their respective lender branch or portal.',
    borrowerImpact: 'Borrowers still tied to MCLR or Base Rate should request their lender to switch their loan to EBLR for transparent repo-rate tracking.',
    importanceScore: 8,
    keywords: ['MCLR', 'EBLR', 'HDFC Bank', 'SBI', 'Refinancing', 'Switch Loan'],
    repoRateMentioned: true,
    currentRepoRate: '6.50%',
    publishedDate: new Date(Date.now() - 14 * 3600 * 1000)
  },
  {
    title: 'Retail Inflation Trajectory and RBI MPC Expectations for the Upcoming Fiscal Quarters',
    source: 'Livemint',
    url: 'https://www.livemint.com/economy/rbi-inflation-repo-rate-forecast-fy26-11709823.html',
    category: 'Economy',
    summary: 'With core inflation cooling down towards 3.8% and food prices stabilizing, financial analysts project that the Reserve Bank of India may initiate a 25-50 bps rate cut cycle in subsequent MPC meetings, offering EMI relief to prospective home buyers.',
    content: 'Economists across major rating agencies anticipate an eventual pivot towards monetary easing once inflation stably anchors around the 4% target. An interest rate easing cycle would reduce borrowing costs across consumer auto loans, personal loans, and long-term home mortgages.',
    borrowerImpact: 'Potential interest rate cuts in late 2026 could lower EMIs and reduce overall loan tenure for existing long-term borrowers.',
    importanceScore: 8,
    keywords: ['Inflation', 'CPI', 'Rate Cut', 'Economic Outlook', 'RBI MPC'],
    repoRateMentioned: true,
    currentRepoRate: '6.50%',
    publishedDate: new Date(Date.now() - 24 * 3600 * 1000)
  },
  {
    title: 'RBI Master Directions on Prepayment Penalties: Floating Rate Personal and Housing Loans',
    source: 'RBI',
    url: 'https://www.rbi.org.in/Scripts/NotificationUser.aspx?Id=12400&Mode=0',
    category: 'RBI Circular',
    summary: 'The Reserve Bank reiterates that no foreclosure charges or prepayment penalties shall be levied by banks and NBFCs on floating rate term loans sanctioned to individual borrowers.',
    content: 'As per RBI master circulars on fair practices code, banks and non-banking financial companies are prohibited from charging foreclosure fees on floating rate loans. This allows borrowers to freely make partial prepayments towards principal reduction without incurring any fee, significantly slashing interest outgo.',
    borrowerImpact: 'Borrowers can prepay floating home or car loans anytime with zero penalty, accelerating debt-free timeline.',
    importanceScore: 9,
    keywords: ['Prepayment', 'Foreclosure', 'Zero Penalty', 'RBI Guidelines'],
    repoRateMentioned: false,
    currentRepoRate: '6.50%',
    publishedDate: new Date(Date.now() - 48 * 3600 * 1000)
  }
];

// Helper to seed if database is empty
async function ensureSeedData() {
  try {
    const count = await FinancialNews.countDocuments();
    if (count === 0) {
      console.log('[NewsController] Seeding initial financial news & repo rate updates...');
      for (const item of SEED_NEWS_DATA) {
        await FinancialNews.findOneAndUpdate({ url: item.url }, item, { upsert: true, new: true });
      }
      // Also trigger a live crawl in the background
      queueNewsCrawl().catch(err => console.warn('[NewsController] Background queue crawl error:', err.message));
    }
  } catch (err) {
    console.warn('[NewsController] Seed check error:', err.message);
  }
}

/**
 * GET /api/news/latest
 * Fetch latest scraped news and repo rate intelligence
 */
export const getLatestNews = async (req, res) => {
  try {
    await ensureSeedData();
    const { limit = 20, category, source, repoOnly } = req.query;
    
    const filter = {};
    if (category && category !== 'All') filter.category = category;
    if (source && source !== 'All') filter.source = source;
    if (repoOnly === 'true') filter.repoRateMentioned = true;

    const newsItems = await FinancialNews.find(filter)
      .sort({ publishedDate: -1, createdAt: -1 })
      .limit(parseInt(limit, 10))
      .lean();

    const formatted = newsItems.map(doc => ({
      _id: doc._id,
      content: doc.content || doc.summary,
      metadata: {
        title: doc.title,
        source: doc.source,
        url: doc.url,
        category: doc.category,
        summary: doc.summary,
        borrowerImpact: doc.borrowerImpact,
        importanceScore: doc.importanceScore,
        keywords: doc.keywords || [],
        repoRateMentioned: doc.repoRateMentioned,
        currentRepoRate: doc.currentRepoRate || '6.50%',
        publishedDate: doc.publishedDate || doc.createdAt
      }
    }));

    res.json({
      success: true,
      count: formatted.length,
      currentRepoRate: '6.50%',
      data: formatted
    });
  } catch (error) {
    console.error('[NewsController] Latest News Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch latest news.', error: error.message });
  }
};

/**
 * GET /api/news/rbi
 * Fetch RBI circulars and notifications
 */
export const getRbiNews = async (req, res) => {
  try {
    await ensureSeedData();
    const { limit = 10 } = req.query;

    const rbiItems = await FinancialNews.find({ source: 'RBI' })
      .sort({ publishedDate: -1 })
      .limit(parseInt(limit, 10))
      .lean();

    const formatted = rbiItems.map(doc => ({
      _id: doc._id,
      content: doc.content || doc.summary,
      metadata: {
        title: doc.title,
        source: doc.source,
        url: doc.url,
        category: doc.category,
        summary: doc.summary,
        borrowerImpact: doc.borrowerImpact,
        importanceScore: doc.importanceScore,
        keywords: doc.keywords || [],
        repoRateMentioned: doc.repoRateMentioned,
        publishedDate: doc.publishedDate || doc.createdAt
      }
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    console.error('[NewsController] RBI News Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch RBI circulars.', error: error.message });
  }
};

/**
 * GET /api/news/repo-rate
 * Dedicated repo rate summary & macroeconomic benchmark stats
 */
export const getRepoRateOverview = async (req, res) => {
  try {
    await ensureSeedData();

    const latestRepoNews = await FinancialNews.find({ repoRateMentioned: true })
      .sort({ publishedDate: -1 })
      .limit(4)
      .lean();

    const stats = {
      policyRepoRate: '6.50%',
      standingDepositFacilityRate: '6.25%',
      marginalStandingFacilityRate: '6.75%',
      bankRate: '6.75%',
      reverseRepoRate: '3.35%',
      mpcStance: 'Neutral / Withdrawal of Accommodation',
      lastRevision: 'February 2026 (Unchanged at 6.50%)',
      benchmarkType: 'EBLR (External Benchmark Lending Rate)',
      floatingRateStatus: 'Stable EMIs across major public and private banks (SBI, HDFC, ICICI, Axis)',
      estimatedNextMeeting: 'April 2026',
      impactRules: [
        {
          change: '+25 bps (+0.25%)',
          emiImpact: '+₹15 - ₹18 per lakh per month on a 20-year loan',
          advice: 'Consider making lump-sum partial prepayments to prevent loan tenure elongation.'
        },
        {
          change: '0 bps (Unchanged 6.50%)',
          emiImpact: 'Zero change in monthly EMI or tenure',
          advice: 'Maintain regular repayment schedule or make voluntary prepayments towards principal.'
        },
        {
          change: '-25 bps (-0.25%)',
          emiImpact: '-₹15 - ₹18 per lakh per month on a 20-year loan',
          advice: 'Keep your EMI payment constant rather than reducing it to close your loan years earlier.'
        }
      ],
      recentArticles: latestRepoNews.map(doc => ({
        id: doc._id,
        title: doc.title,
        source: doc.source,
        url: doc.url,
        summary: doc.summary,
        borrowerImpact: doc.borrowerImpact,
        publishedDate: doc.publishedDate
      }))
    };

    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('[NewsController] Repo Rate Overview Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch repo rate intelligence.' });
  }
};

/**
 * GET /api/news/categories
 */
export const getCategories = async (req, res) => {
  try {
    await ensureSeedData();
    const categories = await FinancialNews.distinct('category');
    const sources = await FinancialNews.distinct('source');
    res.json({
      success: true,
      categories: categories.filter(Boolean),
      sources: sources.filter(Boolean)
    });
  } catch (error) {
    console.error('[NewsController] Categories Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch categories.' });
  }
};

/**
 * GET /api/news/search
 */
export const searchNews = async (req, res) => {
  try {
    const { query, limit = 15, category, source } = req.query;
    if (!query) {
      return res.status(400).json({ success: false, message: 'Query is required.' });
    }

    const filter = {
      $or: [
        { title: { $regex: query, $options: 'i' } },
        { summary: { $regex: query, $options: 'i' } },
        { content: { $regex: query, $options: 'i' } },
        { keywords: { $in: [new RegExp(query, 'i')] } }
      ]
    };
    if (category && category !== 'All') filter.category = category;
    if (source && source !== 'All') filter.source = source;

    const results = await FinancialNews.find(filter)
      .sort({ publishedDate: -1 })
      .limit(parseInt(limit, 10))
      .lean();

    const formatted = results.map(doc => ({
      _id: doc._id,
      content: doc.content || doc.summary,
      metadata: {
        title: doc.title,
        source: doc.source,
        url: doc.url,
        category: doc.category,
        summary: doc.summary,
        borrowerImpact: doc.borrowerImpact,
        importanceScore: doc.importanceScore,
        keywords: doc.keywords || [],
        repoRateMentioned: doc.repoRateMentioned,
        publishedDate: doc.publishedDate
      }
    }));

    res.json({ success: true, count: formatted.length, data: formatted });
  } catch (error) {
    console.error('[NewsController] Search Error:', error);
    res.status(500).json({ success: false, message: 'Failed to search news.' });
  }
};

/**
 * POST /api/news/crawl
 * Triggers scraping job across all financial news portals
 */
export const triggerNewsCrawl = async (req, res) => {
  try {
    console.log('[NewsController] Triggering fresh financial news crawl...');
    
    // In background, start crawl
    queueNewsCrawl().catch(e => console.error('[NewsController] Crawl queue error:', e.message));

    // Also directly crawl primary RBI source synchronously if possible
    setTimeout(async () => {
      try {
        await newsCollectorAgent.processUrl('https://www.rbi.org.in/', 'RBI', 'RBI Circular');
      } catch (e) {
        console.warn('[NewsController] Direct crawl error:', e.message);
      }
    }, 500);

    res.json({ 
      success: true, 
      message: 'Financial news and RBI rate crawler has been triggered. New articles are being parsed and indexed.' 
    });
  } catch (error) {
    console.error('[NewsController] Crawl Trigger Error:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger news crawl.' });
  }
};

/**
 * GET /api/news/debug
 */
export const debugNews = async (req, res) => {
  try {
    const mongoCount = await FinancialNews.countDocuments();
    const sample = await FinancialNews.find().sort({ publishedDate: -1 }).limit(5).lean();
    res.json({
      success: true,
      mongoCount,
      sample
    });
  } catch (error) {
    console.error('[NewsController] Debug Error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch debug info.', error: error.message });
  }
};
