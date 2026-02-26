import express from 'express';
import { getCampaignAnalytics } from '../controllers/analyticsController.js';
import { launchCampaign } from '../controllers/campaignController.js';

const router = express.Router();

// --- Analytics Endpoints ---
router.get('/analytics/:campaignId', getCampaignAnalytics);

// --- Campaign Management Endpoints ---
router.post('/campaigns', express.json({ limit: '50mb' }), launchCampaign);

export default router;
