import "@nomiclabs/hardhat-ethers";
import "@typechain/hardhat";

import { LOCAL_NETWORK, MAINNET_NETWORK } from "@gearbox-protocol/sdk";
import { config as dotEnvConfig } from "dotenv";
import { HardhatUserConfig } from "hardhat/types";

// gets data from .env file
dotEnvConfig();

const config: HardhatUserConfig = {
  defaultNetwork: "hardhat",
  solidity: {
    compilers: [
      {
        version: "0.8.10",

        settings: {
          optimizer: {
            enabled: true,
            runs: 1000000,
          },
        },
      },
    ],
  },
  networks: {
    hardhat: {
      chainId: LOCAL_NETWORK,
      initialBaseFeePerGas: 0,
      allowUnlimitedContractSize: true,
    },
    localhost: {
      timeout: 0,
    },
    mainnet: {
      url: process.env.ETH_MAINNET_PROVIDER || "",
      accounts: [
        "0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3",
      ],
      chainId: MAINNET_NETWORK,
      timeout: 0,
      gasMultiplier: 1.5,
      minGasPrice: 1e9,
      allowUnlimitedContractSize: false,
    },
  },

  typechain: {
    outDir: "types",
    target: "ethers-v5",
  },
};

export default config;
