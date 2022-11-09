import {
  AggregatorV3Interface__factory,
  MCall,
  multicall,
  WAD,
} from "@gearbox-protocol/sdk";
import { BigNumber, Signer } from "ethers";
import * as fs from "fs";
import { ethers } from "hardhat";

import {
  AggregatorInterface__factory,
  AggregatorV3InterfaceFull__factory,
} from "../types";
import { AnswerUpdatedEvent } from "../types/@chainlink/contracts/src/v0.8/interfaces/AggregatorInterface";
import { AggregatorV3InterfaceInterface } from "../types/@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface";
import { AggregatorV3InterfaceFullInterface } from "../types/contracts/IAggregatorV3InterfaceFull.sol/AggregatorV3InterfaceFull";

const DIR = "./data";

const PROGRESS_FILENAME = `${DIR}/progress.json`;
const DATA_FILENAME = `${DIR}/data.csv`;
const DISTRIBUTION_FILENAME = `${DIR}/distribution.json`;

const ETH_USD_PRICEFEED = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const STETH_ETH_PRICEFEED = "0x86392dC19c0b719886221c78AB11eb8Cf5c52812";
const STETH_USD_PRICEFEED = "0xCfE54B5cD566aB89272946F602D76Ea879CAb4a8";

class OracleComparator {
  protected signer: Signer | undefined;
  protected csv = "";
  protected deviationBlocks: Record<number, number> = {};

  async compare() {
    const accounts = await ethers.getSigners();
    this.signer = accounts[0];

    const calls: Array<MCall<AggregatorV3InterfaceInterface>> = [
      ETH_USD_PRICEFEED,
      STETH_ETH_PRICEFEED,
      STETH_USD_PRICEFEED,
    ].map((address) => ({
      address,
      method: "latestRoundData()",
      interface: AggregatorV3Interface__factory.createInterface(),
    }));

    let lastSynced = this.loadProgress();
    const blocks = await this.getBlockUpdates(lastSynced);

    let prevBlock = blocks[0];
    let totalBlocks = 0;
    let blocksUpdated = 0;

    for (let blockTag of blocks) {
      try {
        const [ethPriceData, stethETHPriceData, stETHUSDPriceData] =
          await multicall<
            Array<{
              roundId: BigNumber;
              answer: BigNumber;
              startedAt: BigNumber;
              updatedAt: BigNumber;
              answeredInRound: BigNumber;
            }>
          >(calls, this.signer, {
            blockTag,
          });

        const ethPrice = ethPriceData.answer;
        const stETHethPrice = stethETHPriceData.answer;
        const stETHusdPrice = stETHUSDPriceData.answer;

        const altStETHPrce = stETHethPrice.mul(ethPrice).div(WAD);

        const deviation = Math.abs(
          100 - altStETHPrce.mul(10000).div(stETHusdPrice).toNumber() / 100
        );

        const len = blockTag - prevBlock;
        totalBlocks += len;

        this.csv += `${blockTag},${ethPrice.toString()},${stETHusdPrice.toString()},${altStETHPrce},${deviation.toFixed(
          2
        )}\n`;

        this.deviationBlocks[Math.floor(deviation)] =
          (this.deviationBlocks[Math.floor(deviation)] || 0) + len;

        if (blocksUpdated % 100 === 0) {
          console.log(
            `Processed ${((blocksUpdated * 100) / blocks.length).toFixed(2)}`
          );
          this.saveProgress(blockTag);
        }
      } catch (e) {
        console.log("SKIPPED");
      }

      prevBlock = blockTag;
      blocksUpdated++;
    }
  }

  protected loadProgress(): number {
    if (!fs.existsSync(PROGRESS_FILENAME)) {
      return 0;
    }
    const { synced } = JSON.parse(
      fs.readFileSync(PROGRESS_FILENAME).toString()
    );

    console.log(`Progress file loaded, starting from ${synced}`);

    this.csv = fs.readFileSync(DATA_FILENAME).toString();
    this.deviationBlocks = JSON.parse(
      fs.readFileSync(DISTRIBUTION_FILENAME).toString()
    );

    console.log(this.deviationBlocks);
    return synced;
  }

  protected saveProgress(lastBlock: number) {
    fs.writeFileSync(DATA_FILENAME, this.csv);
    fs.writeFileSync(
      DISTRIBUTION_FILENAME,
      JSON.stringify(this.deviationBlocks)
    );
    fs.writeFileSync(PROGRESS_FILENAME, JSON.stringify({ synced: lastBlock }));
  }

  protected async getBlockUpdates(minNumber = 0): Promise<Array<number>> {
    if (!this.signer) throw new Error("Signer is not set");

    const aggregatorCalls: Array<MCall<AggregatorV3InterfaceFullInterface>> = [
      ETH_USD_PRICEFEED,
      STETH_ETH_PRICEFEED,
      STETH_USD_PRICEFEED,
    ].map((address) => ({
      address,
      method: "aggregator()",
      interface: AggregatorV3InterfaceFull__factory.createInterface(),
    }));

    const aggregators = await multicall<Array<string>>(
      aggregatorCalls,
      this.signer
    );

    const lastBlock = await this.signer.provider!.getBlockNumber();

    const blockSet = new Set<number>();

    for (const aggr of aggregators) {
      const query = await this.greedyQuery(aggr, 0, lastBlock);
      query.slice(1).forEach((e) => blockSet.add(e.blockNumber));

      if (minNumber < query[1].blockNumber) {
        minNumber = query[1].blockNumber;
      }
    }

    return Array.from(blockSet.values()).filter((n) => n >= minNumber);
  }

  protected async greedyQuery(
    address: string,
    from: number,
    to: number,
    step = 0
  ): Promise<Array<AnswerUpdatedEvent>> {
    if (!this.signer) throw new Error("Signer is not set");
    if (step === 100 || to - from < 2) {
      throw new Error("Too much steps to get data");
    }

    try {
      const agg = AggregatorInterface__factory.connect(address, this.signer);
      const query = await agg.queryFilter(
        agg.filters.AnswerUpdated(),
        from,
        to
      );
      return query;
    } catch (e) {
      const middle = Math.floor((from + to) / 2);
      const query1 = await this.greedyQuery(address, from, middle, step + 1);
      const query2 = await this.greedyQuery(address, middle, to, step + 1);
      return [...query1, ...query2];
    }
  }
}

const c = new OracleComparator();

c.compare()
  .then(() => console.log("Ok"))
  .catch((e) => console.log(e));
