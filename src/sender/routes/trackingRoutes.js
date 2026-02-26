import express from 'express';
import { handleOpen, handleClick } from '../controllers/trackingController.js';

const router = express.Router();

// --- Open Tracking Pixel Endpoint ---
// Matches GET /track/o/<eventId>.gif
router.get('/o/:eventId.gif', handleOpen);

// --- Secure Signed Click Redirect Endpoint ---
// Matches GET /track/c/<encodedPayload>/<HMACSignature>
router.get('/c/:payload/:signature', handleClick);

export default router;
