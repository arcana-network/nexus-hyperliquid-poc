import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionResult,
} from "viem";
import { MulticallAbi, MulticallAddress } from "../utils/multicall";
import Decimal from "decimal.js";
import { createResponse } from "../utils/response";
import { debugInfo } from "../utils/debug";
import { fetchUnifiedBalances } from "./cache";

function injectNetworkInterceptor() {
  const originalFetch = window.fetch;

  // @ts-expect-error
  window.decodeFunctionData = decodeFunctionData;
  // @ts-expect-error
  window.MulticallAbi = MulticallAbi;
  // @ts-expect-error
  window.decodeFunctionResult = decodeFunctionResult;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    if (args[1] && args[1].body) {
      const requestBody = args[1].body as any;
      let payloadString;
      try {
        payloadString = new TextDecoder().decode(requestBody);
      } catch (error) {
        payloadString = requestBody;
      }
      let payload;
      try {
        payload = JSON.parse(payloadString);
      } catch (error) {
        return originalFetch.apply(this, args);
      }
      if (
        payload.method === "eth_call" &&
        payload.params?.[0] &&
        payload.params[0].to?.toLowerCase() === MulticallAddress
      ) {
        const decoded = decodeFunctionData({
          abi: MulticallAbi,
          data: payload.params[0].data,
        });
        if (decoded.functionName === "balanceOf") {
          debugInfo("BALANCE OF CALLED", decoded);
        }
        if (decoded.functionName === "aggregate3") {
          const responseData = await response.clone().json();
          if (!responseData.result) {
            debugInfo(
              "No result in aggregate3 response, returning original response"
            );
            return response;
          }
          // try {
          const decodedResult = decodeFunctionResult({
            abi: MulticallAbi,
            functionName: "aggregate3",
            data: responseData.result,
          }) as { success: boolean; returnData: string }[];
          const params = decoded.args![0] as {
            target: string;
            callData: `0x${string}`;
            allowFailure: boolean;
          }[];
          const unifiedBalances = await fetchUnifiedBalances();
          params.forEach((param, pIndex) => {
            try {
              const decodedParam = decodeFunctionData({
                abi: MulticallAbi,
                data: param.callData,
              });
              if (decodedParam.functionName !== "balanceOf") {
                return;
              }
              const index = unifiedBalances.findIndex((bal) =>
                bal.breakdown.find(
                  (asset) =>
                    asset.contractAddress.toLowerCase() ===
                    param.target.toLowerCase()
                )
              );
              if (index === -1) {
                return;
              }
              const asset = unifiedBalances[index];
              const actualAsset = asset.breakdown.find(
                (token) =>
                  token.contractAddress.toLowerCase() ===
                  param.target.toLowerCase()
              );
              decodedResult[pIndex].returnData = encodeFunctionResult({
                abi: MulticallAbi,
                functionName: "balanceOf",
                result: BigInt(
                  new Decimal(asset.balance)
                    .mul(
                      Decimal.pow(10, actualAsset!.decimals || asset.decimals)
                    )
                    .floor()
                    .toFixed()
                ),
              });
            } catch (error) {
              console.error(
                "Failed to decode callData for target:",
                param.target,
                "Error:",
                error
              );
            }
          });
          const modifiedResult = encodeFunctionResult({
            abi: MulticallAbi,
            functionName: "aggregate3",
            result: decodedResult,
          });
          return createResponse({
            jsonrpc: "2.0",
            id: payload.id,
            result: modifiedResult,
          });
          // } catch (e) {
          //   debugInfo(
          //     "error occured, falling back to send original response",
          //     e
          //   );
          //   return response;
          // }
        }
      }
    }
    return response;
  };
}

injectNetworkInterceptor();
