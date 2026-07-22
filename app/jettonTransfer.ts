import TonWeb from "tonweb";

export async function createJettonTransferPayload(
  destinationAddressString: string,
  amountInTokens: number = 5
): Promise<string> {
  const tonweb = new TonWeb();

  const destinationAddress = new TonWeb.Address(destinationAddressString);

  const forwardPayload = new TonWeb.boc.Cell();
  forwardPayload.bits.writeUint(0, 32);
  forwardPayload.bits.writeString(`Course Purchase - ${amountInTokens} Tokens`);

  const jettonTransferBody = new TonWeb.boc.Cell();
  jettonTransferBody.bits.writeUint(0xf8a7ea5, 32); // Opcode for Jetton Transfer
  jettonTransferBody.bits.writeUint(0, 64); // Query ID
  jettonTransferBody.bits.writeCoins(TonWeb.utils.toNano(amountInTokens.toString())); // Token amount
  jettonTransferBody.bits.writeAddress(destinationAddress); // Destination address
  jettonTransferBody.bits.writeAddress(destinationAddress); // Response address
  jettonTransferBody.bits.writeBit(false); // Custom payload flag
  jettonTransferBody.bits.writeCoins(TonWeb.utils.toNano("0.02")); // Forward amount in TON
  jettonTransferBody.bits.writeBit(true); // Forward payload flag
  jettonTransferBody.refs.push(forwardPayload);

  const bocBytes = await jettonTransferBody.toBoc();
  return TonWeb.utils.bytesToBase64(bocBytes);
}