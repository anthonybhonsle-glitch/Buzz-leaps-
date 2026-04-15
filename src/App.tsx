/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useCallback, useRef, Component } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Trophy, RotateCcw, Play, Pause, Info, 
  Zap, Hammer, RefreshCw, Star, 
  Clock, Infinity as InfinityIcon, LayoutGrid,
  Settings, ChevronRight, LogIn, LogOut, User as UserIcon,
  Crown, Medal, Hash
} from 'lucide-react';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  User as FirebaseUser,
  signOut
} from 'firebase/auth';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  serverTimestamp,
  doc,
  setDoc,
  getDoc,
  getDocFromServer,
  Timestamp
} from 'firebase/firestore';
import { auth, db } from './firebase';

// --- Types ---

type BlockShape = number[][];
type GameMode = 'classic' | 'timed' | 'zen';

interface Block {
  id: string;
  shape: BlockShape;
  color: string;
}

interface Particle {
  id: string;
  x: number;
  y: number;
  color: string;
}

interface LeaderboardEntry {
  id: string;
  userId: string;
  userName: string;
  score: number;
  mode: GameMode;
  timestamp: Timestamp;
}

// --- Error Handling ---

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null, onError?: (msg: string) => void) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  if (onError) {
    let message = "Something went wrong.";
    try {
      if (errInfo.error) message = `Game Error: ${errInfo.error}`;
    } catch {
      message = String(error);
    }
    onError(message);
  }
  throw new Error(JSON.stringify(errInfo));
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// --- Constants ---

const GRID_SIZE = 8;
const INITIAL_TIME = 120; // 2 minutes for Timed Mode

const THEMES = {
  classic: {
    bg: 'bg-slate-50',
    grid: 'bg-slate-200',
    cell: 'bg-slate-100',
    text: 'text-slate-900',
    colors: ['#FF4D4D', '#4D79FF', '#4DFF4D', '#FFD633', '#B366FF', '#FF944D', '#4DFFFF']
  },
  neon: {
    bg: 'bg-slate-950',
    grid: 'bg-slate-900',
    cell: 'bg-slate-800',
    text: 'text-white',
    colors: ['#00f2ff', '#00ff88', '#ff0077', '#7700ff', '#ffff00', '#ff8800', '#ff00ff']
  }
};

const SHAPES: BlockShape[] = [
  [[1]], [[1, 1]], [[1], [1]], [[1, 1, 1]], [[1], [1], [1]],
  [[1, 1, 1, 1]], [[1], [1], [1], [1]], [[1, 1, 1, 1, 1]], [[1], [1], [1], [1], [1]],
  [[1, 1], [1, 1]], [[1, 1, 1], [1, 1, 1], [1, 1, 1]], 
  [[1, 0], [1, 1]], [[0, 1], [1, 1]], [[1, 1], [1, 0]], [[1, 1], [0, 1]],
  [[1, 0, 0], [1, 1, 1]], [[0, 0, 1], [1, 1, 1]], [[1, 1, 1], [1, 0, 0]], [[1, 1, 1], [0, 0, 1]],
  [[1, 1, 1], [0, 1, 0]], [[0, 1, 0], [1, 1, 1]], [[1, 0], [1, 1], [1, 0]], [[0, 1], [1, 1], [0, 1]],
];

// --- Utilities ---

const generateId = () => Math.random().toString(36).substr(2, 9);

const getRandomBlock = (colors: string[]): Block => {
  const shapeIndex = Math.floor(Math.random() * SHAPES.length);
  const colorIndex = Math.floor(Math.random() * colors.length);
  return {
    id: generateId(),
    shape: SHAPES[shapeIndex],
    color: colors[colorIndex],
  };
};

// --- Components ---

export default function App() {
  const [error, setError] = useState<string | null>(null);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8 bg-slate-50 text-center">
        <div className="max-w-md bg-white p-8 rounded-3xl shadow-xl">
          <h2 className="text-2xl font-black text-red-500 mb-4">Oops!</h2>
          <p className="text-slate-600 mb-8">{error}</p>
          <button 
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-blue-500 text-white rounded-xl font-bold shadow-lg"
          >
            RELOAD GAME
          </button>
        </div>
      </div>
    );
  }

  return <Game onError={setError} />;
}

function Game({ onError }: { onError: (msg: string) => void }) {
  // Game State
  const [mode, setMode] = useState<GameMode>('classic');
  const [grid, setGrid] = useState<(string | null)[][]>(
    Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null))
  );
  const [availableBlocks, setAvailableBlocks] = useState<Block[]>([]);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [timeLeft, setTimeLeft] = useState(INITIAL_TIME);
  const [gameOver, setGameOver] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showMenu, setShowMenu] = useState(true);
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  // Auth State
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardMode, setLeaderboardMode] = useState<GameMode>('classic');

  // Power-ups
  const [hammers, setHammers] = useState(3);
  const [shuffles, setShuffles] = useState(2);
  const [isHammerActive, setIsHammerActive] = useState(false);

  // Subscription State
  const [isPro, setIsPro] = useState(false);
  const [showPricing, setShowPricing] = useState(false);

  // UI State
  const [theme, setTheme] = useState<keyof typeof THEMES>('classic');
  const [draggedBlock, setDraggedBlock] = useState<Block | null>(null);
  const [hoverPos, setHoverPos] = useState<{ r: number; c: number } | null>(null);
  const [particles, setParticles] = useState<Particle[]>([]);

  const gridRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const currentTheme = THEMES[theme];

  // --- Localization Helper ---
  const getLocalizedPrice = (baseUsd: number) => {
    const locale = navigator.language || 'en-US';
    const rates: Record<string, { code: string; rate: number }> = {
      'en-GB': { code: 'GBP', rate: 0.8 },
      'ja-JP': { code: 'JPY', rate: 150 },
      'hi-IN': { code: 'INR', rate: 83 },
      'de-DE': { code: 'EUR', rate: 0.95 },
      'fr-FR': { code: 'EUR', rate: 0.95 },
    };

    const config = rates[locale] || { code: 'USD', rate: 1 };
    const localizedAmount = baseUsd * config.rate;

    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: config.code,
    }).format(localizedAmount);
  };

  // Initialize
  useEffect(() => {
    const saved = localStorage.getItem('blockBlast_stats');
    if (saved) {
      const stats = JSON.parse(saved);
      setHighScore(stats.highScore || 0);
      setIsPro(stats.isPro || false);
    }

    // Auth listener
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      setIsAuthReady(true);
      if (firebaseUser) {
        // Sync user profile
        try {
          await setDoc(doc(db, 'users', firebaseUser.uid), {
            uid: firebaseUser.uid,
            displayName: firebaseUser.displayName,
            photoURL: firebaseUser.photoURL,
            highScore: highScore,
            isPro: isPro
          }, { merge: true });
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, `users/${firebaseUser.uid}`, onError);
        }
      }
    });

    // Test connection
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    return () => unsubscribe();
  }, []);

  // Leaderboard listener
  useEffect(() => {
    if (!isAuthReady) return;

    const q = query(
      collection(db, 'scores'),
      orderBy('score', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const entries = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as LeaderboardEntry))
        .filter(entry => entry.mode === leaderboardMode);
      setLeaderboard(entries);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'scores', onError);
    });

    return () => unsubscribe();
  }, [isAuthReady, leaderboardMode]);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const logout = () => signOut(auth);

  const submitScore = async (finalScore: number) => {
    if (!user || finalScore <= 0) return;
    try {
      await addDoc(collection(db, 'scores'), {
        userId: user.uid,
        userName: user.displayName || 'Anonymous',
        score: finalScore,
        mode: mode,
        timestamp: serverTimestamp()
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'scores', onError);
    }
  };

  const handleSubscribe = (type: 'pro' | 'free') => {
    if (type === 'pro') {
      setIsPro(true);
      localStorage.setItem('blockBlast_stats', JSON.stringify({ highScore, isPro: true }));
    } else {
      setIsPro(false);
      localStorage.setItem('blockBlast_stats', JSON.stringify({ highScore, isPro: false }));
    }
    setShowPricing(false);
  };

  // Timer for Timed Mode
  useEffect(() => {
    if (mode === 'timed' && !isPaused && !gameOver && !showMenu) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current!);
            setGameOver(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [mode, isPaused, gameOver, showMenu]);

  const startNewRound = useCallback(() => {
    setAvailableBlocks([
      getRandomBlock(currentTheme.colors),
      getRandomBlock(currentTheme.colors),
      getRandomBlock(currentTheme.colors)
    ]);
  }, [currentTheme.colors]);

  const startGame = (selectedMode: GameMode) => {
    if ((selectedMode === 'timed' || selectedMode === 'zen') && !isPro) {
      setShowPricing(true);
      return;
    }
    setMode(selectedMode);
    setGrid(Array(GRID_SIZE).fill(null).map(() => Array(GRID_SIZE).fill(null)));
    setScore(0);
    setCombo(0);
    setTimeLeft(INITIAL_TIME);
    setGameOver(false);
    setIsPaused(false);
    setShowMenu(false);
    setHammers(3);
    setShuffles(2);
    startNewRound();
  };

  const resetGame = () => {
    startGame(mode);
  };

  const createParticles = (r: number, c: number, color: string) => {
    const newParticles = Array.from({ length: 6 }).map(() => ({
      id: generateId(),
      x: c * 40 + 20,
      y: r * 40 + 20,
      color
    }));
    setParticles(prev => [...prev, ...newParticles]);
    setTimeout(() => {
      setParticles(prev => prev.filter(p => !newParticles.find(np => np.id === p.id)));
    }, 800);
  };

  const canPlaceBlock = (currentGrid: (string | null)[][], shape: BlockShape, row: number, col: number) => {
    for (let r = 0; r < shape.length; r++) {
      for (let c = 0; c < shape[0].length; c++) {
        if (shape[r][c] === 1) {
          const gridR = row + r;
          const gridC = col + c;
          if (
            gridR < 0 || gridR >= GRID_SIZE ||
            gridC < 0 || gridC >= GRID_SIZE ||
            currentGrid[gridR][gridC] !== null
          ) {
            return false;
          }
        }
      }
    }
    return true;
  };

  const checkGameOver = (currentGrid: (string | null)[][], blocks: Block[]) => {
    if (mode === 'zen') return false; // Zen mode never ends
    if (blocks.length === 0) return false;

    for (const block of blocks) {
      for (let r = 0; r <= GRID_SIZE - block.shape.length; r++) {
        for (let c = 0; c <= GRID_SIZE - block.shape[0].length; c++) {
          if (canPlaceBlock(currentGrid, block.shape, r, c)) {
            return false;
          }
        }
      }
    }
    return true;
  };

  const handleZenStuck = (currentGrid: (string | null)[][]) => {
    // In Zen mode, if stuck, clear a 3x3 area in the middle or shuffle
    const newGrid = currentGrid.map(row => [...row]);
    const startR = Math.floor(Math.random() * (GRID_SIZE - 3));
    const startC = Math.floor(Math.random() * (GRID_SIZE - 3));
    
    for (let r = startR; r < startR + 3; r++) {
      for (let c = startC; c < startC + 3; c++) {
        if (newGrid[r][c]) createParticles(r, c, newGrid[r][c]!);
        newGrid[r][c] = null;
      }
    }
    setGrid(newGrid);
    setAvailableBlocks([
      getRandomBlock(currentTheme.colors),
      getRandomBlock(currentTheme.colors),
      getRandomBlock(currentTheme.colors)
    ]);
  };

  const placeBlock = (block: Block, row: number, col: number) => {
    if (!canPlaceBlock(grid, block.shape, row, col)) return;

    const newGrid = grid.map(r => [...r]);
    let blocksPlaced = 0;
    for (let r = 0; r < block.shape.length; r++) {
      for (let c = 0; c < block.shape[0].length; c++) {
        if (block.shape[r][c] === 1) {
          newGrid[row + r][col + c] = block.color;
          blocksPlaced++;
        }
      }
    }

    const rowsToClear: number[] = [];
    const colsToClear: number[] = [];

    for (let r = 0; r < GRID_SIZE; r++) {
      if (newGrid[r].every(cell => cell !== null)) rowsToClear.push(r);
    }
    for (let c = 0; c < GRID_SIZE; c++) {
      if (newGrid.every(r => r[c] !== null)) colsToClear.push(c);
    }

    const linesCleared = rowsToClear.length + colsToClear.length;
    let points = blocksPlaced;

    if (linesCleared > 0) {
      const newCombo = combo + 1;
      setCombo(newCombo);
      points += Math.floor(linesCleared * 20 * linesCleared * (1 + newCombo * 0.2));
      
      rowsToClear.forEach(r => {
        for (let c = 0; c < GRID_SIZE; c++) {
          createParticles(r, c, newGrid[r][c] || '#fff');
          newGrid[r][c] = null;
        }
      });
      colsToClear.forEach(c => {
        for (let r = 0; r < GRID_SIZE; r++) {
          if (newGrid[r][c]) createParticles(r, c, newGrid[r][c] || '#fff');
          newGrid[r][c] = null;
        }
      });

      // In Timed mode, clearing lines adds time
      if (mode === 'timed') {
        setTimeLeft(prev => Math.min(prev + linesCleared * 5, INITIAL_TIME));
      }
    } else {
      setCombo(0);
    }

    const newScore = score + points;
    setScore(newScore);
    if (newScore > highScore) {
      setHighScore(newScore);
      localStorage.setItem('blockBlast_stats', JSON.stringify({ highScore: newScore, isPro }));
      // Update user doc if logged in
      if (user) {
        setDoc(doc(db, 'users', user.uid), { highScore: newScore }, { merge: true })
          .catch(err => handleFirestoreError(err, OperationType.UPDATE, `users/${user.uid}`, onError));
      }
    }

    setGrid(newGrid);
    const remaining = availableBlocks.filter(b => b.id !== block.id);
    setAvailableBlocks(remaining);

    if (remaining.length === 0) {
      const next = [
        getRandomBlock(currentTheme.colors),
        getRandomBlock(currentTheme.colors),
        getRandomBlock(currentTheme.colors)
      ];
      setAvailableBlocks(next);
      if (checkGameOver(newGrid, next)) {
        if (mode === 'zen') handleZenStuck(newGrid);
        else {
          setGameOver(true);
          submitScore(newScore);
        }
      }
    } else if (checkGameOver(newGrid, remaining)) {
      if (mode === 'zen') handleZenStuck(newGrid);
      else {
        setGameOver(true);
        submitScore(newScore);
      }
    }
  };

  const useHammer = (r: number, c: number) => {
    if (!isHammerActive || hammers <= 0 || grid[r][c] === null) return;
    const newGrid = grid.map(row => [...row]);
    createParticles(r, c, grid[r][c]!);
    newGrid[r][c] = null;
    setGrid(newGrid);
    setHammers(h => h - 1);
    setIsHammerActive(false);
  };

  const useShuffle = () => {
    if (shuffles <= 0 || gameOver || isPaused || showMenu) return;
    startNewRound();
    setShuffles(s => s - 1);
  };

  // --- Handlers ---

  const handleDragMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!draggedBlock || !gridRef.current) return;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const rect = gridRef.current.getBoundingClientRect();
    const cellSize = rect.width / GRID_SIZE;
    const col = Math.floor((clientX - rect.left) / cellSize);
    const row = Math.floor((clientY - rect.top) / cellSize);

    if (row >= 0 && row <= GRID_SIZE - draggedBlock.shape.length && col >= 0 && col <= GRID_SIZE - draggedBlock.shape[0].length) {
      setHoverPos({ r: row, c: col });
    } else {
      setHoverPos(null);
    }
  };

  // --- Render ---

  if (showMenu) {
    return (
      <div className={`min-h-screen ${currentTheme.bg} flex flex-col items-center justify-center p-8 transition-colors duration-500`}>
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-md text-center"
        >
          <h1 className={`text-6xl font-black tracking-tighter mb-2 ${currentTheme.text}`}>
            BLOCK<span className="text-blue-500 italic">BLAST</span>
            {isPro && <span className="ml-2 text-xs bg-blue-500 text-white px-2 py-0.5 rounded-full italic">PRO</span>}
          </h1>
          <p className="text-slate-500 font-bold uppercase tracking-widest text-xs mb-8">Ultimate Puzzle Challenge</p>
          
          {!isPro && (
            <button 
              onClick={() => setShowPricing(true)}
              className="mb-8 w-full bg-gradient-to-r from-yellow-400 to-orange-500 text-white p-4 rounded-2xl font-black shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2 hover:scale-105 transition-transform"
            >
              <Zap size={18} fill="currentColor" />
              UPGRADE TO PRO
            </button>
          )}

          <div className="flex flex-col gap-4">
            <button 
              onClick={() => startGame('classic')}
              className="group flex items-center justify-between p-6 bg-white dark:bg-slate-800 rounded-3xl shadow-xl hover:scale-105 transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-100 dark:bg-blue-900/30 text-blue-500 rounded-2xl">
                  <LayoutGrid size={24} />
                </div>
                <div className="text-left">
                  <div className={`font-black ${currentTheme.text}`}>CLASSIC</div>
                  <div className="text-xs text-slate-400 font-medium">Traditional 8x8 Strategy</div>
                </div>
              </div>
              <ChevronRight className="text-slate-300 group-hover:text-blue-500 transition-colors" />
            </button>

            <button 
              onClick={() => startGame('timed')}
              className="group flex items-center justify-between p-6 bg-white dark:bg-slate-800 rounded-3xl shadow-xl hover:scale-105 transition-all relative overflow-hidden"
            >
              {!isPro && (
                <div className="absolute top-0 right-0 bg-blue-500 text-white text-[8px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-tighter">
                  PRO MODE
                </div>
              )}
              <div className="flex items-center gap-4">
                <div className="p-3 bg-red-100 dark:bg-red-900/30 text-red-500 rounded-2xl">
                  <Clock size={24} />
                </div>
                <div className="text-left">
                  <div className={`font-black ${currentTheme.text}`}>TIMED</div>
                  <div className="text-xs text-slate-400 font-medium">2 Minutes Speed Run</div>
                </div>
              </div>
              <ChevronRight className="text-slate-300 group-hover:text-red-500 transition-colors" />
            </button>

            <button 
              onClick={() => startGame('zen')}
              className="group flex items-center justify-between p-6 bg-white dark:bg-slate-800 rounded-3xl shadow-xl hover:scale-105 transition-all relative overflow-hidden"
            >
              {!isPro && (
                <div className="absolute top-0 right-0 bg-blue-500 text-white text-[8px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-tighter">
                  PRO MODE
                </div>
              )}
              <div className="flex items-center gap-4">
                <div className="p-3 bg-green-100 dark:bg-green-900/30 text-green-500 rounded-2xl">
                  <InfinityIcon size={24} />
                </div>
                <div className="text-left">
                  <div className={`font-black ${currentTheme.text}`}>ZEN</div>
                  <div className="text-xs text-slate-400 font-medium">Infinite Relaxing Play</div>
                </div>
              </div>
              <ChevronRight className="text-slate-300 group-hover:text-green-500 transition-colors" />
            </button>

            <button 
              onClick={() => setShowLeaderboard(true)}
              className="group flex items-center justify-between p-6 bg-white dark:bg-slate-800 rounded-3xl shadow-xl hover:scale-105 transition-all"
            >
              <div className="flex items-center gap-4">
                <div className="p-3 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-600 rounded-2xl">
                  <Trophy size={24} />
                </div>
                <div className="text-left">
                  <div className={`font-black ${currentTheme.text}`}>LEADERBOARD</div>
                  <div className="text-xs text-slate-400 font-medium">Global Top Scores</div>
                </div>
              </div>
              <ChevronRight className="text-slate-300 group-hover:text-yellow-500 transition-colors" />
            </button>
          </div>

          <div className="mt-12 flex justify-center gap-4">
            {user ? (
              <button 
                onClick={logout}
                className="flex items-center gap-2 p-4 bg-white dark:bg-slate-800 rounded-2xl shadow-lg text-slate-500 hover:text-red-500 transition-colors"
              >
                <img src={user.photoURL || ""} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
                <span className="text-xs font-bold uppercase tracking-widest">Logout</span>
              </button>
            ) : (
              <button 
                onClick={login}
                className="flex items-center gap-2 p-4 bg-white dark:bg-slate-800 rounded-2xl shadow-lg text-slate-500 hover:text-blue-500 transition-colors"
              >
                <LogIn size={24} />
                <span className="text-xs font-bold uppercase tracking-widest">Login</span>
              </button>
            )}
            <button 
              onClick={() => setTheme(theme === 'classic' ? 'neon' : 'classic')}
              className="p-4 bg-white dark:bg-slate-800 rounded-2xl shadow-lg text-slate-500 hover:text-blue-500 transition-colors"
            >
              <Star size={24} className={theme === 'neon' ? 'text-yellow-400 fill-yellow-400' : ''} />
            </button>
          </div>
        </motion.div>

        {/* Leaderboard Modal */}
        <AnimatePresence>
          {showLeaderboard && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[110] flex items-center justify-center p-4"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white dark:bg-slate-900 w-full max-w-md rounded-[32px] p-8 shadow-2xl flex flex-col max-h-[90vh]"
              >
                <div className="flex justify-between items-center mb-6">
                  <h2 className={`text-3xl font-black ${currentTheme.text}`}>Hall of Fame</h2>
                  <button onClick={() => setShowLeaderboard(false)} className="p-2 text-slate-400 hover:text-slate-600">
                    <RotateCcw size={20} />
                  </button>
                </div>

                {/* Mode Selector */}
                <div className="flex gap-2 mb-6 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
                  {(['classic', 'timed', 'zen'] as GameMode[]).map(m => (
                    <button
                      key={m}
                      onClick={() => setLeaderboardMode(m)}
                      className={`flex-1 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${leaderboardMode === m ? 'bg-white dark:bg-slate-700 text-blue-500 shadow-sm' : 'text-slate-400'}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>

                <div className="flex-1 overflow-y-auto pr-2 space-y-3 custom-scrollbar">
                  {leaderboard.length > 0 ? leaderboard.map((entry, index) => (
                    <div 
                      key={entry.id}
                      className={`flex items-center justify-between p-4 rounded-2xl ${entry.userId === user?.uid ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-500' : 'bg-slate-50 dark:bg-slate-800/50'}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className="w-8 flex justify-center">
                          {index === 0 ? <Crown size={20} className="text-yellow-500" /> : 
                           index === 1 ? <Medal size={20} className="text-slate-400" /> :
                           index === 2 ? <Medal size={20} className="text-orange-400" /> :
                           <span className="text-xs font-black text-slate-300">#{index + 1}</span>}
                        </div>
                        <div className="text-left">
                          <div className={`text-sm font-black ${currentTheme.text}`}>{entry.userName}</div>
                          <div className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">
                            {entry.timestamp?.toDate().toLocaleDateString()}
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-black text-blue-500">{entry.score.toLocaleString()}</div>
                      </div>
                    </div>
                  )) : (
                    <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                      <Hash size={40} className="mb-4 opacity-20" />
                      <p className="text-sm font-bold uppercase tracking-widest">No scores yet</p>
                    </div>
                  )}
                </div>

                <button 
                  onClick={() => setShowLeaderboard(false)}
                  className="mt-8 w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black text-sm shadow-xl"
                >
                  BACK TO MENU
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Pricing Modal */}
        <AnimatePresence>
          {showPricing && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/80 backdrop-blur-md z-[100] flex items-center justify-center p-6"
            >
              <motion.div 
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[32px] p-8 shadow-2xl relative overflow-hidden"
              >
                <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 to-cyan-400" />
                
                <h2 className={`text-3xl font-black mb-1 ${currentTheme.text}`}>Choose Your Plan</h2>
                <p className="text-slate-500 text-xs font-bold uppercase tracking-widest mb-8">Unlock the full experience</p>

                <div className="flex flex-col gap-4 mb-8">
                  {/* Free Plan */}
                  <button 
                    onClick={() => handleSubscribe('free')}
                    className={`flex items-center justify-between p-5 rounded-2xl border-2 transition-all ${!isPro ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-100 dark:border-slate-800'}`}
                  >
                    <div className="text-left">
                      <div className={`font-black ${currentTheme.text}`}>FREE LIFETIME</div>
                      <div className="text-[10px] text-slate-400 font-bold">Classic Mode Only</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-black ${currentTheme.text}`}>{getLocalizedPrice(0)}</div>
                      <div className="text-[8px] text-slate-400 font-bold uppercase">Forever</div>
                    </div>
                  </button>

                  {/* Pro Plan */}
                  <button 
                    onClick={() => handleSubscribe('pro')}
                    className={`flex items-center justify-between p-5 rounded-2xl border-2 transition-all relative overflow-hidden ${isPro ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-slate-100 dark:border-slate-800'}`}
                  >
                    <div className="absolute top-0 right-0 bg-blue-500 text-white text-[8px] font-black px-3 py-1 rounded-bl-xl uppercase tracking-tighter">
                      BEST VALUE
                    </div>
                    <div className="text-left">
                      <div className={`font-black ${currentTheme.text}`}>PRO MONTHLY</div>
                      <div className="text-[10px] text-slate-400 font-bold">All Modes + Power-ups</div>
                    </div>
                    <div className="text-right">
                      <div className="font-black text-blue-500">{getLocalizedPrice(1)}</div>
                      <div className="text-[8px] text-slate-400 font-bold uppercase">Per Month</div>
                    </div>
                  </button>
                </div>

                <div className="space-y-3 mb-8">
                  <div className="flex items-center gap-3 text-xs font-medium text-slate-500">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    Timed & Zen Game Modes
                  </div>
                  <div className="flex items-center gap-3 text-xs font-medium text-slate-500">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    Unlimited Power-up Refills
                  </div>
                  <div className="flex items-center gap-3 text-xs font-medium text-slate-500">
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    Exclusive Neon Theme
                  </div>
                </div>

                <button 
                  onClick={() => setShowPricing(false)}
                  className="w-full py-4 text-slate-400 font-bold text-xs hover:text-slate-600 transition-colors"
                >
                  MAYBE LATER
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className={`min-h-screen ${currentTheme.bg} transition-colors duration-500 flex flex-col items-center p-4 md:p-8 select-none font-sans`}>
      
      {/* Header */}
      <div className="w-full max-w-[440px] flex flex-col gap-4 mb-8">
        <div className="flex justify-between items-start">
          <div>
            <button onClick={() => setShowMenu(true)} className={`text-2xl font-black tracking-tighter ${currentTheme.text} flex items-center gap-1`}>
              BLOCK<span className="text-blue-500 italic">BLAST</span>
            </button>
            <div className="flex items-center gap-3 mt-1">
              <div className="flex items-center gap-1 text-slate-400 text-[10px] font-bold uppercase tracking-wider">
                <Trophy size={10} className="text-yellow-500" />
                <span>Best: {highScore}</span>
              </div>
              {mode === 'timed' && (
                <div className={`flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider ${timeLeft < 20 ? 'text-red-500 animate-pulse' : 'text-slate-400'}`}>
                  <Clock size={10} />
                  <span>{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-col items-end">
            <motion.div 
              key={score}
              initial={{ scale: 1.2 }}
              animate={{ scale: 1 }}
              className={`text-4xl font-black ${currentTheme.text}`}
            >
              {score}
            </motion.div>
            <div className="text-[8px] font-black text-slate-400 uppercase tracking-widest">Score</div>
          </div>
        </div>

        {/* Combo Bar */}
        <div className="h-1.5 w-full bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
          <motion.div 
            animate={{ width: `${Math.min(combo * 10, 100)}%` }}
            className="h-full bg-gradient-to-r from-blue-500 to-cyan-400"
          />
        </div>
      </div>

      {/* Grid Area */}
      <div className="relative w-full max-w-[400px]">
        <div 
          ref={gridRef}
          className={`grid grid-cols-8 gap-1 p-2 ${currentTheme.grid} rounded-2xl shadow-2xl relative aspect-square w-full transition-all duration-300`}
          onMouseMove={handleDragMove}
          onTouchMove={handleDragMove}
        >
          {grid.map((row, r) => 
            row.map((cell, c) => {
              const isHovered = hoverPos && 
                r >= hoverPos.r && r < hoverPos.r + (draggedBlock?.shape.length || 0) &&
                c >= hoverPos.c && c < hoverPos.c + (draggedBlock?.shape[0].length || 0) &&
                draggedBlock?.shape[r - hoverPos.r][c - hoverPos.c] === 1;

              const canPlace = isHovered && draggedBlock && canPlaceBlock(grid, draggedBlock.shape, hoverPos.r, hoverPos.c);

              return (
                <div 
                  key={`${r}-${c}`}
                  onClick={() => useHammer(r, c)}
                  className={`aspect-square rounded-lg transition-all duration-200 relative ${isHammerActive && cell ? 'cursor-crosshair ring-2 ring-red-500' : ''}`}
                  style={{ 
                    backgroundColor: cell || (isHovered ? (canPlace ? draggedBlock?.color : '#ef444444') : (theme === 'classic' ? '#f1f5f9' : '#1e293b')),
                    opacity: isHovered ? 0.7 : 1,
                    boxShadow: cell ? 'inset -2px -2px 4px rgba(0,0,0,0.1)' : 'none'
                  }}
                />
              );
            })
          )}

          {/* Particles */}
          {particles.map(p => (
            <motion.div
              key={p.id}
              initial={{ x: p.x, y: p.y, scale: 1, opacity: 1 }}
              animate={{ 
                x: p.x + (Math.random() - 0.5) * 100, 
                y: p.y + (Math.random() - 0.5) * 100,
                scale: 0,
                opacity: 0
              }}
              className="absolute w-2 h-2 rounded-full pointer-events-none z-50"
              style={{ backgroundColor: p.color }}
            />
          ))}
        </div>

        {/* Overlays */}
        <AnimatePresence>
          {(isPaused || gameOver) && (
            <motion.div 
              initial={{ opacity: 0, backdropFilter: 'blur(0px)' }}
              animate={{ opacity: 1, backdropFilter: 'blur(8px)' }}
              className="absolute inset-0 bg-slate-900/60 z-40 rounded-2xl flex flex-col items-center justify-center p-8 text-center"
            >
              {gameOver ? (
                <div className="bg-white rounded-3xl p-8 shadow-2xl w-full max-w-[280px]">
                  <h2 className="text-2xl font-black text-slate-900 mb-1">GAME OVER</h2>
                  <p className="text-slate-500 text-xs mb-6 font-bold uppercase tracking-widest">{mode} Mode</p>
                  
                  <div className="flex flex-col gap-2 mb-8">
                    <div className="flex justify-between items-center px-4 py-2 bg-slate-100 rounded-xl">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">Score</span>
                      <span className="text-xl font-black text-slate-900">{score}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <button 
                      onClick={() => setShowMenu(true)}
                      className="flex-1 bg-slate-100 text-slate-600 py-3 rounded-xl font-bold text-sm"
                    >
                      MENU
                    </button>
                    <button 
                      onClick={resetGame}
                      className="flex-[2] bg-blue-500 text-white py-3 rounded-xl font-bold text-sm shadow-lg shadow-blue-500/30"
                    >
                      RETRY
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-6">
                  <h2 className="text-4xl font-black text-white tracking-widest">PAUSED</h2>
                  <button 
                    onClick={() => setIsPaused(false)}
                    className="w-20 h-20 bg-blue-500 text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 transition-transform"
                  >
                    <Play size={40} fill="currentColor" />
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Dock */}
      <div className="w-full max-w-[440px] mt-8">
        <div className="flex justify-center items-center gap-6 h-32 bg-white/50 dark:bg-white/5 rounded-3xl p-4 backdrop-blur-sm border border-white/10">
          {availableBlocks.map((block) => (
            <motion.div
              key={block.id}
              drag
              dragSnapToOrigin
              onDragStart={() => { if (!gameOver && !isPaused) setDraggedBlock(block); }}
              onDragEnd={() => { setDraggedBlock(null); setHoverPos(null); }}
              className="cursor-grab active:cursor-grabbing z-20"
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 1.2 }}
            >
              <div 
                className="grid gap-0.5"
                style={{ 
                  gridTemplateRows: `repeat(${block.shape.length}, 1fr)`,
                  gridTemplateColumns: `repeat(${block.shape[0].length}, 1fr)`,
                }}
              >
                {block.shape.map((row, r) => 
                  row.map((cell, c) => (
                    <div 
                      key={`${r}-${c}`}
                      className="w-5 h-5 rounded-md"
                      style={{ 
                        backgroundColor: cell === 1 ? block.color : 'transparent',
                        boxShadow: cell === 1 ? 'inset -1px -1px 2px rgba(0,0,0,0.1)' : 'none'
                      }}
                    />
                  ))
                )}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Power-ups */}
        <div className="flex justify-between items-center mt-6 px-2">
          <div className="flex gap-3">
            <button 
              onClick={() => setIsHammerActive(!isHammerActive)}
              className={`relative flex flex-col items-center gap-1 p-3 rounded-2xl transition-all ${isHammerActive ? 'bg-red-500 text-white shadow-lg' : 'bg-white dark:bg-slate-800 text-slate-500'}`}
            >
              <Hammer size={20} />
              <span className="text-[8px] font-black uppercase tracking-widest">Hammer ({hammers})</span>
            </button>

            <button 
              onClick={useShuffle}
              disabled={shuffles <= 0}
              className="flex flex-col items-center gap-1 p-3 bg-white dark:bg-slate-800 text-slate-500 rounded-2xl shadow-sm disabled:opacity-50"
            >
              <RefreshCw size={20} />
              <span className="text-[8px] font-black uppercase tracking-widest">Shuffle ({shuffles})</span>
            </button>
          </div>

          <div className="flex gap-2">
            <button 
              onClick={() => setIsPaused(true)}
              className="p-3 bg-white dark:bg-slate-800 text-slate-500 rounded-2xl"
            >
              <Pause size={20} />
            </button>
            <button 
              onClick={resetGame}
              className="p-3 bg-white dark:bg-slate-800 text-slate-500 rounded-2xl"
            >
              <RotateCcw size={20} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
