import { getQueue, registerWorker } from '../utils/queueManager.js';
import { newsCollectorAgent } from './agents/newsCollectorAgent.js';

const NEWS_CRAWL_QUEUE = 'news_crawl';

const SOURCES = [
  { name: 'RBI', url: 'https://www.rbi.org.in/' },
  { name: 'Moneycontrol', url: 'https://www.moneycontrol.com/news/business/economy/' },
  { name: 'Livemint', url: 'https://www.livemint.com/economy' },
  { name: 'Economic Times', url: 'https://economictimes.indiatimes.com/news/economy' },
  { name: 'Business Standard', url: 'https://www.business-standard.com/economy' },
  { name: 'Financial Express', url: 'https://www.financialexpress.com/economy/' },
  { name: 'CNBC', url: 'https://www.cnbctv18.com/economy/' }
];

/**
 * Triggered by cron, queues individual crawl jobs
 */
export const queueNewsCrawl = async () => {
  const queue = getQueue(NEWS_CRAWL_QUEUE);
  
  for (const source of SOURCES) {
    await queue.add('crawl_site', source);
    console.log(`[NewsScheduler] Queued crawl for ${source.name}`);
  }
};

/**
 * Worker for crawling
 */
registerWorker(NEWS_CRAWL_QUEUE, async (job) => {
  const { name, url } = job.data;
  console.log(`[NewsWorker] Processing crawl for ${name}`);
  // In a real scenario, this would first discover links on the page, then process them.
  // For this MVP, we process the single URL.
  await newsCollectorAgent.processUrl(url, name);
});
