import db from '../models/db.js';

/**
 * High-performance analytics engine utilizing SQLite aggregates.
 * Designed to quickly calculate CTR, CTOR, Delivery Rates, etc. across potentially millions of rows.
 */
const getCampaignAnalytics = (req, res) => {
  const { campaignId } = req.params;

  try {
    // 1. Fetch Total Recipients and Delivery/Bounce counts
    // Using a single pass over the recipients table
    const recipientStats = db.prepare(`
      SELECT 
        COUNT(id) as totalSent,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as deliveredCount,
        SUM(CASE WHEN status = 'bounced' THEN 1 ELSE 0 END) as bouncedCount
      FROM recipients
      WHERE campaignId = ?
    `).get(campaignId);

    // 2. Fetch Unique Event Logs (Opens, Clicks, Visits)
    // COUNT(DISTINCT recipientId) ensures we only count "Unique Opens/Clicks" instead of gross opens
    const eventStats = db.prepare(`
      SELECT 
        SUM(CASE WHEN eventType = 'OPEN' THEN 1 ELSE 0 END) as uniqueOpens,
        SUM(CASE WHEN eventType = 'CLICK' THEN 1 ELSE 0 END) as uniqueClicks,
        SUM(CASE WHEN eventType = 'WEBSITE_VISIT' THEN 1 ELSE 0 END) as uniqueVisits
      FROM (
        SELECT eventType, recipientId 
        FROM event_logs 
        WHERE campaignId = ?
        GROUP BY eventType, recipientId
      )
    `).get(campaignId);

    const sent = recipientStats.totalSent || 0;
    const delivered = recipientStats.deliveredCount || 0;
    const bounced = recipientStats.bouncedCount || 0;

    const opens = eventStats.uniqueOpens || 0;
    const clicks = eventStats.uniqueClicks || 0;
    const visits = eventStats.uniqueVisits || 0;

    // 3. Calculate Derived Ratios
    // Protect against division by zero
    const deliveryRate = sent > 0 ? (delivered / sent) * 100 : 0;
    const bounceRate = sent > 0 ? (bounced / sent) * 100 : 0;

    // Core Marketing Metrics
    const openRate = delivered > 0 ? (opens / delivered) * 100 : 0;
    const clickThroughRate = delivered > 0 ? (clicks / delivered) * 100 : 0; // CTR
    const clickToOpenRate = opens > 0 ? (clicks / opens) * 100 : 0; // CTOR
    const websiteVisitRate = clicks > 0 ? (visits / clicks) * 100 : 0;

    res.json({
      campaignId,
      rawCounts: {
        sent,
        delivered,
        bounced,
        uniqueOpens: opens,
        uniqueClicks: clicks,
        uniqueVisits: visits
      },
      metrics: {
        deliveryRate: deliveryRate.toFixed(2) + '%',
        bounceRate: bounceRate.toFixed(2) + '%',
        openRate: openRate.toFixed(2) + '%',
        clickThroughRate: clickThroughRate.toFixed(2) + '%',
        clickToOpenRate: clickToOpenRate.toFixed(2) + '%',
        websiteVisitRate: websiteVisitRate.toFixed(2) + '%'
      }
    });

  } catch (error) {
    console.error(`[Analytics Controller] Error calculating metrics for campaign ${campaignId}: ${error.message}`);
    res.status(500).json({ error: 'Failed to calculate analytics.' });
  }
};

export {
  getCampaignAnalytics
};
