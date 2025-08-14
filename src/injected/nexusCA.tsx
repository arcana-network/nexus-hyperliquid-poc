import { CA, Network, type EthereumProvider } from "@arcana/ca-sdk";
import { debugInfo } from "../utils/debug";
import Decimal from "decimal.js";
import {
  decodeFunctionData,
  decodeFunctionResult,
  encodeFunctionResult,
} from "viem";
import {
  erc20TransferAbi,
  MulticallAbi,
  MulticallAddress,
} from "../utils/multicall";
import { createRoot, Root } from "react-dom/client";
import { useEffect, useRef } from "react";
import { TOKEN_MAPPING } from "../utils/constants";
import { clearCache, fetchUnifiedBalances } from "./cache";
import { LifiAbi } from "../utils/lifi.abi";

type EVMProvider = EthereumProvider & {
  isConnected?: () => Promise<boolean>;
  selectedAddress?: string;
};

const providers = [] as {
  info: {
    name: string;
  };
  provider: EVMProvider;
}[];

window.addEventListener("eip6963:announceProvider", (event: any) => {
  debugInfo("eip6963:announceProvider event received:", event);
  if (!providers.find((p) => p.info.name === event.detail.info.name)) {
    providers.push(event.detail);
  }
});

// The DApp dispatches a request event which will be heard by
// Wallets' code that had run earlier
window.dispatchEvent(new Event("eip6963:requestProvider"));

let reactRoot: Root;

function render(App: React.FC) {
  const nexusRoot = document.getElementById("nexus-root");
  if (!nexusRoot) {
    const newNexusRoot = document.createElement("div");
    newNexusRoot.id = "nexus-root";
    document.body.appendChild(newNexusRoot);
  }

  if (!reactRoot) {
    reactRoot = createRoot(document.getElementById("nexus-root")!);
  }

  fixAppModal();

  try {
    debugInfo("RENDERING APP");
    reactRoot.render(<App />);
  } catch (e) {
    debugInfo("ERROR RENDERING APP", e);
  }
}

function fixAppModal() {
  document
    .querySelector(".sc-bBABsx.fAsTrb:has(.sc-fLcnxK.iOdKba.modal)")
    ?.setAttribute("style", "z-index: 40");
  document
    .querySelector(".sc-bBABsx.jWjRYk:has(.modal)")
    ?.setAttribute("style", "z-index: 40");
}

function NexusApp() {
  const ca = new CA({
    network: Network.CORAL,
    debug: true,
    // Add SIWE statement below
    // siweStatement: ""
  });
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    debugInfo("Detected Providers", providers);
    for (const provider of providers) {
      if (provider.provider.selectedAddress) {
        ca.setEVMProvider(provider.provider);
        ca.init().then(() => {
          window.nexus = ca;
          fetchUnifiedBalances();
        });
      }
      provider.provider.on("accountsChanged", (event) => {
        debugInfo("ON ACCOUNT CHANGED", event);
        if (event.length) {
          ca.setEVMProvider(provider.provider);
          ca.init().then(() => {
            window.nexus = ca;
            fetchUnifiedBalances();
          });
        } else {
          ca.deinit();
          clearCache();
        }
      });
      provider.provider.on("connect", (event) => {
        debugInfo("ON CONNECT", event);
        ca.setEVMProvider(provider.provider);
        ca.init().then(() => {
          window.nexus = ca;
          fetchUnifiedBalances();
        });
      });

      const originalRequest = provider.provider.request;
      debugInfo("Adding Request Interceptor", provider);
      provider.provider.request = async function (...args) {
        debugInfo("Intercepted in useEffect", ...args);
        const { method, params } = args[0] as {
          method: string;
          params?: any[];
        };
        debugInfo("Intercepted request:", method, params, provider.provider);
        if (
          method === "eth_call" &&
          params?.[0] &&
          params[0].data.toLowerCase().startsWith("0x70a08231")
        ) {
          debugInfo("BALANCE OF CALLED INSIDE REQUEST", params);
        }
        if (
          method === "eth_sendTransaction" &&
          params?.[0] &&
          (params[0].data.toLowerCase().startsWith("0xa9059cbb") || // ERC20 transfer
            params[0].data.toLowerCase().startsWith("0x23b872dd")) // ERC20 transferFrom
        ) {
          const unifiedBalances = await fetchUnifiedBalances();
          const tokenAddress = params[0].to.toLowerCase() as string;
          const tokenIndex = unifiedBalances.findIndex((bal) =>
            bal.breakdown.find(
              (token) => token.contractAddress.toLowerCase() === tokenAddress
            )
          );
          if (tokenIndex === -1) {
            return originalRequest.apply(this, args);
          }
          const actualToken = unifiedBalances[tokenIndex].breakdown.find(
            (token) => token.contractAddress.toLowerCase() === tokenAddress
          );
          const decodedData = decodeFunctionData({
            abi: erc20TransferAbi,
            data: params[0].data,
          });

          const paramAmount = params[0].data
            .toLowerCase()
            .startsWith("0xa9059cbb")
            ? (decodedData.args![1] as bigint).toString()
            : (decodedData.args![2] as bigint).toString();

          const amount = new Decimal(paramAmount)
            .div(Decimal.pow(10, actualToken?.decimals || 0))
            .toFixed();

          debugInfo("amount decoded:", amount);
          debugInfo("actual contract:", decodedData.args![0]);
          debugInfo("actual transaction:", args[0]);

          if (
            new Decimal(actualToken?.balance || "0")
              .mul(Decimal.pow(10, actualToken?.decimals || 0))
              .lessThan(paramAmount)
          ) {
            const requiredAmount = new Decimal(paramAmount)
              .minus(
                Decimal.mul(
                  actualToken?.balance || "0",
                  Decimal.pow(10, actualToken?.decimals || 0)
                )
              )
              .div(Decimal.pow(10, actualToken?.decimals || 0))
              .toFixed();
            const handler = await ca.bridge({
              amount: requiredAmount,
              token:
                TOKEN_MAPPING[42161][
                  tokenAddress.toLowerCase()
                ].symbol.toLowerCase(),
              chainID: 42161,
            });
            const res = await handler.exec();
            debugInfo("BRIDGE Response", res);
            return originalRequest.apply(this, args);
          }
        }

        if (
          method === "eth_sendTransaction" &&
          params?.[0] &&
          params[0].data.toLowerCase().startsWith("0x4666fc80")
        ) {
          const unifiedBalances = await fetchUnifiedBalances();
          const decodedData = decodeFunctionData({
            abi: LifiAbi,
            data: params[0].data,
          });
          debugInfo(
            "LIFI DECODED",
            decodedData.args[5].fromAmount,
            decodedData.args[5].sendingAssetId
          );
          const paramAmount = decodedData.args[5].fromAmount.toString();
          const tokenAddress = decodedData.args[5].sendingAssetId.toLowerCase();

          const tokenIndex = unifiedBalances.findIndex((bal) =>
            bal.breakdown.find(
              (token) => token.contractAddress.toLowerCase() === tokenAddress
            )
          );
          if (tokenIndex === -1) {
            return originalRequest.apply(this, args);
          }
          const actualToken = unifiedBalances[tokenIndex].breakdown.find(
            (token) => token.contractAddress.toLowerCase() === tokenAddress
          );
          const amount = new Decimal(paramAmount)
            .div(Decimal.pow(10, actualToken?.decimals || 0))
            .toFixed();

          if (
            new Decimal(actualToken?.balance || "0")
              .mul(Decimal.pow(10, actualToken?.decimals || 0))
              .lessThan(paramAmount)
          ) {
            const requiredAmount = new Decimal(paramAmount)
              .minus(
                Decimal.mul(
                  actualToken?.balance || "0",
                  Decimal.pow(10, actualToken?.decimals || 0)
                )
              )
              .div(Decimal.pow(10, actualToken?.decimals || 0))
              .toFixed();
            const handler = await ca.bridge({
              amount: requiredAmount,
              token:
                TOKEN_MAPPING[42161][
                  tokenAddress.toLowerCase()
                ].symbol.toLowerCase(),
              chainID: 42161,
            });
            const res = await handler.exec();
            debugInfo("BRIDGE Response", res);
            return originalRequest.apply(this, args);
          }
        }

        if (
          method === "eth_call" &&
          params?.[0] &&
          params[0].to?.toLowerCase() === MulticallAddress
        ) {
          const decoded = decodeFunctionData({
            abi: MulticallAbi,
            data: params[0].data,
          });
          const responseData = await originalRequest.apply(this, args);
          if (decoded.functionName === "aggregate3") {
            if (!responseData) {
              debugInfo(
                "No result in aggregate3 response, returning original response"
              );
              return responseData;
            }
            const res = responseData as `0x${string}`;
            const decodedResult = decodeFunctionResult({
              abi: MulticallAbi,
              functionName: "aggregate3",
              data: res,
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
            return modifiedResult;
          }
          return responseData;
        }
        return originalRequest.apply(this, args);
      };
    }
  }, []);

  return window.nexus ? (
    <div />
  ) : (
    // Insert Bridging UI here
    <div />
  );
}

function NexusProviderApp() {
  return (
    <div>
      <NexusApp />
    </div>
  );
}

render(NexusProviderApp);
