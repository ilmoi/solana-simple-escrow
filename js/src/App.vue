<template>
  <div>
    <div id="app" class="flex flex-row">

      <div class="bg-pink-200 flex-1 m-10">
        <h3 class="font-bold m-1">Alice</h3>
        <form @submit.prevent="initEscrowFE">
          <div class="flex flex-row m-1">
            <label for="a_main">Main acc:</label>
            <input type="text" id="a_main" v-model="a_main" class="flex-grow" @change="updateBalance()">
            <p class="mx-2">{{ a_main_balance }}</p>
          </div>
          <div class="flex flex-row m-1">
            <label for="a_x_acc">X acc:</label>
            <input type="text" id="a_x_acc" v-model="a_x_acc" class="flex-grow" @change="updateAXTokenBalance()">
            <p class="mx-2">{{ a_x_balance }}</p>
          </div>
          <div class="flex flex-row m-1">
            <label for="a_y_acc">Y acc:</label>
            <input type="text" id="a_y_acc" v-model="a_y_acc" class="flex-grow" @change="updateAYTokenBalance">
            <p class="mx-2"> {{ a_y_balance }} </p>
          </div>
          <div class="flex flex-row m-1">
            <label for="a_pk">PK:</label>
            <input type="text" id="a_pk" v-model="a_pk" class="flex-grow">
          </div>
          <div class="flex flex-row m-1">
            <label for="a_x_size">X to trade:</label>
            <input type="text" id="a_x_size" v-model="a_x_size" class="flex-grow">
          </div>
          <div class="flex flex-row m-1">
            <label for="a_y_size">Y to recv:</label>
            <input type="text" id="a_y_size" v-model="a_y_size" class="flex-grow">
          </div>
          <button type="submit" class="m-1 bg-pink-800 text-white">init escrow</button>
        </form>
      </div>

      <div class="bg-blue-200 flex-1 m-10">
        <h3 class="font-bold m-1">Bob</h3>
        <form @submit.prevent="takeTradeFE">
          <div class="flex flex-row m-1">
            <label for="b_main">Main acc:</label>
            <input type="text" id="b_main" v-model="b_main" class="flex-grow" @change="updateBalance()">
            <p class="mx-2">{{ b_main_balance }}</p>
          </div>
          <div class="flex flex-row m-1">
            <label for="b_x_acc">X acc:</label>
            <input type="text" id="b_x_acc" v-model="b_x_acc" class="flex-grow" @change="updateBXTokenBalance()">
            <p class="mx-2">{{ b_x_balance }}</p>
          </div>
          <div class="flex flex-row m-1">
            <label for="b_y_acc">Y acc:</label>
            <input type="text" id="b_y_acc" v-model="b_y_acc" class="flex-grow" @change="updateBYTokenBalance">
            <p class="mx-2"> {{ b_y_balance }} </p>
          </div>
          <div class="flex flex-row m-1">
            <label for="b_pk">PK:</label>
            <input type="text" id="b_pk" v-model="b_pk" class="flex-grow">
          </div>
          <div class="flex flex-row m-1">
            <label for="b_x_size">X to expect:</label>
            <input type="text" id="b_x_size" v-model="b_x_size" class="flex-grow">
          </div>
          <div class="flex flex-row m-1">
            <label for="b_y_size">Y to send:</label>
            <input type="text" id="b_y_size" v-model="b_y_size" class="flex-grow">
          </div>
          <button type="submit" class="m-1 bg-blue-800 text-white">take trade</button>
        </form>
      </div>
    </div>

    <div class="bg-gray-200 m-10">
      <h3 class="font-bold m-1">Program</h3>
      <form @submit.prevent="" class="flex flex-row">
        <div class="flex-1 mr-10">
          <div class="flex flex-row m-1">
            <label for="program_id">Program ID:</label>
            <input type="text" id="program_id" v-model="program_id" class="flex-grow">
          </div>
          <div class="flex flex-row m-1">
            <label for="escrow_acc">Escrow Account:</label>
            <input type="text" id="escrow_acc" v-model="escrow_acc" class="flex-grow" @change="updateEscrowInfo">
          </div>
          <button type="submit" class="m-1 bg-gray-800 text-white">reset escrow</button>
        </div>
        <div class="flex-1 ml-10">
          <div class="m-1">Initialized: {{ is_initialized }}</div>
          <div class="m-1">Initializer: {{ initializer }}</div>
          <div class="m-1 flex flex-row">
            <div class="flex-grow-1">Initializer's temp X acc: {{ initializer_x_temp_acc }}</div>
            <div>{{ x_temp_balance }}</div>
          </div>
          <div class="m-1">Initializer's Y acc: {{ initializer_y_acc }}</div>
          <div class="m-1">Expected Y tokens: {{ initializer_expected_y }}</div>
        </div>
      </form>
    </div>

    <button @click="runWalletFE">click me</button>
  </div>
</template>

<script>
import {
  connect,
  CONNECTION,
  getBalance, getEscrowInfo,
  getInfo,
  getTokenBalance, initEscrow, takeTrade,
} from "@/sol-api";
import {LAMPORTS_PER_SOL, PublicKey} from "@solana/web3.js";
import BigNumber from 'bignumber.js'
import {connectWallet, takeTradeSigned} from "@/wallet-api";

export default {
  data() {
    return {
      // ----------------------------------------------------------------------------- Alice
      a_main: "Ga8HG4NzgcYkegLoJDmxJemEU1brewF2XZLNHd6B4wJ7",
      a_x_acc: "BTUDi8DcxQzXp1KQ5p95dkuBgTtqirDxySZrXbM6nHPk", //todo derive automatically?
      a_y_acc: "pLBauX3VV2QWJsnakYdAjHh193EuhZc6UMpdYT5DsCK", //todo derive automatically?
      a_pk: "201,101,147,128,138,189,70,190,202,49,28,26,32,21,104,185,191,41,20,171,3,144,4,26,169,73,180,171,71,22,48,135,231,91,179,215,3,117,187,183,96,74,154,155,197,243,114,104,20,123,105,47,181,123,171,133,73,181,102,41,236,78,210,176", //todo sign using a wallet instead
      a_x_size: new BigNumber("10").toString(),
      a_y_size: new BigNumber("10").toString(),
      a_main_balance: new BigNumber("0").toString(),
      a_x_balance: new BigNumber("0").toString(),
      a_y_balance: new BigNumber("0").toString(),
      // ----------------------------------------------------------------------------- Bob
      b_main: "Ga8HG4NzgcYkegLoJDmxJemEU1brewF2XZLNHd6B4wJ7",
      b_x_acc: "993dEBeJvmoEUsVracRaYMALxYWvE3jwfh2bktE9mLKi", //todo derive automatically?
      b_y_acc: "EYXaZeXZkBiPK5gG3U1prEj7S3iu14yh57pP7KGCUjBH", //todo derive automatically?
      b_pk: "177,217,193,155,63,150,164,184,81,82,121,165,202,87,86,237,218,226,212,201,167,170,149,183,59,43,155,112,189,239,231,110,162,218,184,20,108,2,92,114,203,184,223,69,137,206,102,71,162,0,127,63,170,96,137,108,228,31,181,113,57,189,30,76", //todo sign using a wallet instead
      b_x_size: new BigNumber("10").toString(),
      b_y_size: new BigNumber("10").toString(),
      b_main_balance: new BigNumber("0").toString(),
      b_x_balance: new BigNumber("0").toString(),
      b_y_balance: new BigNumber("0").toString(),
      // ----------------------------------------------------------------------------- Program
      program_id: "5B7bxDnoCG9PvCnSHLN65KvTy1BsUX4oxDmaQpjBPSG",
      escrow_acc: "Fqt59CYejnQGaCgHTP79LvKdXYf91JNXXX99vK7SkrE5", //derived from program id

      is_initialized: false,
      initializer: "",
      initializer_x_temp_acc: "",
      initializer_y_acc: "",
      initializer_expected_y: new BigNumber("0").toString(),
      x_temp_balance: new BigNumber("0").toString(),

    }
  },
  methods: {
    // todo in theory I need to write custom handlers instead of v-model, which would transform entered integers into BigNumber but for this toy app cba
    //  just imagine numbers are hardcoded and can't be changed

    async updateBalance() {
      this.a_main_balance = new BigNumber(`${(await getBalance(this.a_main) / LAMPORTS_PER_SOL)}`)
    },
    // todo https://forum.vuejs.org/t/is-it-possible-to-pass-a-data-property-as-argument-to-a-method/119075
    // async updateTokenBalance(token) {
    //   let balance = await getTokenBalance(token);
    //   return balance.value.uiAmount;
    // },
    async updateAXTokenBalance() {
      if (this.a_x_acc) {
        let balance = await getTokenBalance(this.a_x_acc);
        this.a_x_balance = new BigNumber(`${balance.value.uiAmount}`).toString();
      }
    },
    async updateAYTokenBalance() {
      if (this.a_y_acc) {
        let balance = await getTokenBalance(this.a_y_acc);
        this.a_y_balance = new BigNumber(`${balance.value.uiAmount}`).toString();
      }
    },
    async updateBXTokenBalance() {
      if (this.b_x_acc) {
        let balance = await getTokenBalance(this.b_x_acc);
        this.b_x_balance = new BigNumber(`${balance.value.uiAmount}`).toString();
      }
    },
    async updateBYTokenBalance() {
      if (this.b_y_acc) {
        let balance = await getTokenBalance(this.b_y_acc);
        this.b_y_balance = new BigNumber(`${balance.value.uiAmount}`).toString();
      }
    },
    async updateTempXTokenBalance() {
      if (this.initializer_x_temp_acc) {
        let balance = await getTokenBalance(this.initializer_x_temp_acc);
        this.x_temp_balance = new BigNumber(`${balance.value.uiAmount}`).toString();
      } else {
        this.x_temp_balance = null;
      }
    },
    async updateEscrowInfo() {
      try {
        let deserEscrow = await getEscrowInfo(this.escrow_acc);
        this.is_initialized = Boolean(deserEscrow.is_initialized);
        this.initializer = new PublicKey(deserEscrow.initializer_pubkey).toBase58();
        this.initializer_x_temp_acc = new PublicKey(deserEscrow.temp_token_account_pubkey).toBase58();
        this.initializer_y_acc = new PublicKey(deserEscrow.initializer_token_to_receive_account_pubkey).toBase58();
        this.initializer_expected_y = deserEscrow.expected_amount;
      } catch (e) {
        this.is_initialized = false;
        this.initializer = null;
        this.initializer_x_temp_acc = null;
        this.initializer_y_acc = null;
        this.initializer_expected_y = null;
      }
      await this.updateTempXTokenBalance();
    },
    async updateAll() {
      await this.updateBalance();
      await this.updateAXTokenBalance();
      await this.updateAYTokenBalance();
      await this.updateBXTokenBalance();
      await this.updateBYTokenBalance();
      await this.updateEscrowInfo();
    },
    async initEscrowFE() {
      console.log("initiating a new escrow")
      this.escrow_acc = await initEscrow(
          this.a_pk,
          this.a_x_acc,
          this.a_y_acc,
          this.a_x_size,
          this.a_y_size,
          this.program_id,
      )
      //after we're done let's also refresh the pulled state
      await this.updateAll();
    },
    async takeTradeFE() {
      console.log("taking the trade")
      await takeTradeSigned(
          // this.b_pk,
          this.b_x_acc,
          this.b_y_acc,
          this.initializer_x_temp_acc,
          this.initializer,
          this.initializer_y_acc,
          this.b_x_size,
          this.escrow_acc,
          this.program_id,
      )
      //after we're done let's also refresh the pulled state
      await this.updateAll();
    },
    async runWalletFE() {
      await connectWallet()
    }
  },
  async created() {
    await connect();
    await this.updateAll();
  }
}
</script>

<style>
input {
  @apply border border-solid border-black;
}

label {
  width: 100px;
}
</style>