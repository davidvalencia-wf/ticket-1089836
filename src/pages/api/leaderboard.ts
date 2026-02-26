import type { APIRoute } from 'astro';
import { desc } from 'drizzle-orm';
import { getDb } from '../../../db';
import { leaderboard } from '../../../db/schema';

type LeaderboardObject = {
	initials: string;
	score: number;
	level: number;
	powerups_enabled: boolean;
	token?: string;
};

const corsHeaders = {
	'Access-Control-Allow-Origin': '*', // Or specify your domain instead of *
	'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
	'Access-Control-Allow-Headers': 'Content-Type',
};

export const OPTIONS: APIRoute = async () => {
	return new Response(null, {
		headers: corsHeaders,
	});
};
export const POST: APIRoute = async ({ request, locals }) => {
	try {
		const { initials, score, level, powerups_enabled, token }: LeaderboardObject = await request.json();

		// Validate input
		if (!initials || typeof initials !== 'string' || initials.length > 3) {
			return new Response(JSON.stringify({ error: 'Invalid initials' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}

		if (typeof score !== 'number' || typeof level !== 'number') {
			return new Response(JSON.stringify({ error: 'Invalid score or level' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}

		if (level % 1 !== 0 || level < 1) {
			return new Response(JSON.stringify({ error: 'Invalid level' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}

		if (!isFinite(score) || score < 0) {
			return new Response(JSON.stringify({ error: 'Invalid score' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}

		let highestPossibleScore = 0;
		for (let currentLevel = 1; currentLevel <= level; currentLevel++) {
			const enemiesThisLevel = 15 + (currentLevel - 1) * 5;
			const scorePerEnemy = 100 * currentLevel;
			highestPossibleScore += enemiesThisLevel * scorePerEnemy;
		}

		if (score > highestPossibleScore) {
			return new Response(JSON.stringify({ error: 'Score exceeds maximum possible for level progression' }), {
				status: 400,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		if (typeof powerups_enabled !== 'boolean') {
			return new Response(JSON.stringify({ error: 'Invalid powerups_enabled' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}

		if (typeof token !== 'string') {
			return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
		}

		// Validate session token if provided and KV is available
		const KV = locals.runtime?.env?.GAME_SESSIONS;
		if (token && KV) {
			const sessionData = await KV.get(token);

			if (!sessionData) {
				return new Response(JSON.stringify({ error: 'Invalid or expired session' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
			}

			const session = JSON.parse(sessionData);

			// Check if token was already used
			if (session.used) {
				return new Response(JSON.stringify({ error: 'Session token already used' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
			}

			// Validate minimum game time (10 seconds)
			const timePlayed = Date.now() - session.startTime;
			if (timePlayed < 2500) {
				return new Response(JSON.stringify({ error: 'Invalid game duration' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
			}


			// Mark token as used
			await KV.put(
				token,
				JSON.stringify({
					...session,
					used: true,
				}),
				{ expirationTtl: 3600 },
			);
		}

		// Get D1 database from runtime
		const db = getDb(locals);

		// Insert the leaderboard entry
		const result = await db
			.insert(leaderboard)
			.values({
				initials: initials.toUpperCase(),
				score,
				level,
				powerups_enabled: powerups_enabled,
				createdAt: new Date().toISOString(),
			})
			.returning();

		return new Response(JSON.stringify({ success: true, entry: result[0] }), { status: 201, headers: { 'Content-Type': 'application/json' } });
	} catch (error) {
		console.error('Error saving leaderboard entry:', error);
		return new Response(JSON.stringify({ error: 'Failed to save leaderboard entry' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
	}
};

export const GET: APIRoute = async ({ locals }) => {
	try {
		const db = getDb(locals);

		// Get top 10 scores
		const topScores = await db.select().from(leaderboard).orderBy(desc(leaderboard.score)).limit(10);

		return new Response(JSON.stringify({ success: true, leaderboard: topScores }), { status: 200, headers: { 'Content-Type': 'application/json' } });
	} catch (error) {
		console.error('Error fetching leaderboard:', error);
		return new Response(JSON.stringify({ error: 'Failed to fetch leaderboard' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
	}
};
