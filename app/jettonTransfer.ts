import TonWeb from "tonweb";

// آدرس رسمی USDT روی شبکه اصلی TON
export const USDT_MASTER_ADDRESS = "EQCxE6mUtQJKFnGfaROTKOt1lZbDiiX1kCixRv7Nw2Id_sDs";



export async function getUserJettonWalletAddress(userAddressString: string): Promise<string> {
  const tonweb = new TonWeb();

  const jettonMinter = new TonWeb.token.jetton.JettonMinter(tonweb.provider, {
    address: USDT_MASTER_ADDRESS,
  } as any);

  const jettonWalletAddress = await jettonMinter.getJettonWalletAddress(
    new TonWeb.Address(userAddressString)
  );

  return jettonWalletAddress.toString(true, true, true);
}

export async function createUSDTTransferPayload(
  merchantAddressString: string,
  amountInUsdt: number
): Promise<string> {
  const destinationAddress = new TonWeb.Address(merchantAddressString);
  const rawAmount = Math.floor(amountInUsdt * 1e6);

  const forwardPayload = new TonWeb.boc.Cell();
  forwardPayload.bits.writeUint(0, 32);
  forwardPayload.bits.writeString(`↓ Received  + $${amountInUsdt}`);

  const jettonTransferBody = new TonWeb.boc.Cell();
  jettonTransferBody.bits.writeUint(0xf8a7ea5, 32); // Opcode برای Jetton Transfer
  jettonTransferBody.bits.writeUint(0, 64); // Query ID
  jettonTransferBody.bits.writeCoins(new TonWeb.utils.BN(rawAmount.toString()));
  jettonTransferBody.bits.writeAddress(destinationAddress); // پاسخ‌دهنده به واریز
  jettonTransferBody.bits.writeAddress(destinationAddress); // بازگشت کارمزد اضافه
  jettonTransferBody.bits.writeBit(false); // custom_payload null
  jettonTransferBody.bits.writeCoins(TonWeb.utils.toNano("0.01")); // Forward Amount
  jettonTransferBody.bits.writeBit(true); // forward_payload in ref
  jettonTransferBody.refs.push(forwardPayload);

  const bocBytes = await jettonTransferBody.toBoc();
  return TonWeb.utils.bytesToBase64(bocBytes);
}