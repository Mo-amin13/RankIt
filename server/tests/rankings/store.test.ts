import { InMemoryRankingStore } from "../../src/rankings/store.js"
import { describeRankingStore } from "./storeContract.js"

describeRankingStore("InMemoryRankingStore", () => new InMemoryRankingStore())
