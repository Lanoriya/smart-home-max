import { Router } from 'express';
import { getPrivacy, privacyPage } from '../companies/privacy.js';

// The privacy policy for everyone: JSON for the mini-app, a page for the bot.
export const privacyRouter = Router();

privacyRouter.get('/', async (_request, response, next) => {
  try { response.json({ item: await getPrivacy() }); } catch (error) { next(error); }
});

privacyRouter.get('/page', async (_request, response, next) => {
  try { response.type('html').send(privacyPage(await getPrivacy())); } catch (error) { next(error); }
});
