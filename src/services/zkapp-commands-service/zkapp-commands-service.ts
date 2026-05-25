import type postgres from 'postgres';
import {
  BlockStatusFilter,
  type BlockInfo,
  type ZkappCommand,
  type ZkappCommands,
} from '../../blockchain/types.js';
import type { ZkappCommandFilterOptionsInput } from '../../resolvers-types.js';
import { getZkappCommandsQuery } from '../../db/sql/zkapp-commands/queries.js';
import type { ZkappCommandDatabaseRow } from '../../db/sql/zkapp-commands/types.js';
import {
  TracingState,
  extractTraceStateFromOptions,
} from '../../tracing/tracer.js';
import { BLOCK_RANGE_SIZE } from '../../server/server.js';
import { throwBlockRangeError } from '../../errors/error.js';
import type { IZkappCommandsService } from './zkapp-commands-service.interface.js';

export { ZkappCommandsService };
export { normalizeZkappCommandRange };

function normalizeZkappCommandRange(input: ZkappCommandFilterOptionsInput): {
  from?: number;
  to?: number;
} {
  const { from, to } = input;
  const hasFrom = from !== null && from !== undefined;
  const hasTo = to !== null && to !== undefined;
  let rangeFrom = hasFrom ? from : undefined;
  let rangeTo = hasTo ? to : undefined;

  if (hasTo && hasFrom && to < from) {
    throwBlockRangeError('to must be greater than from');
  }
  if (hasTo && hasFrom && to - from > BLOCK_RANGE_SIZE) {
    throwBlockRangeError(
      `The block range is too large. The maximum range is ${BLOCK_RANGE_SIZE}`
    );
  }
  if (hasFrom && !hasTo) {
    rangeTo = from + BLOCK_RANGE_SIZE;
  }
  if (hasTo && !hasFrom) {
    rangeFrom = to - BLOCK_RANGE_SIZE;
  }

  return { from: rangeFrom, to: rangeTo };
}

class ZkappCommandsService implements IZkappCommandsService {
  private readonly client: postgres.Sql;

  constructor(client: postgres.Sql) {
    this.client = client;
  }

  async getZkappCommands(
    input: ZkappCommandFilterOptionsInput,
    options: unknown
  ): Promise<ZkappCommands> {
    const tracingState = extractTraceStateFromOptions(options);
    return (await this.getZkappCommandData(input, { tracingState })) ?? [];
  }

  async getZkappCommandData(
    input: ZkappCommandFilterOptionsInput,
    { tracingState }: { tracingState: TracingState }
  ): Promise<ZkappCommands> {
    const sqlSpan = tracingState.startSpan('zkappCommands.SQL');
    const rows = await this.executeZkappCommandsQuery(input);
    sqlSpan.end();

    const processingSpan = tracingState.startSpan('zkappCommands.processing');
    const commands = this.rowsToZkappCommands(rows);
    processingSpan.end();
    return commands;
  }

  private async executeZkappCommandsQuery(
    input: ZkappCommandFilterOptionsInput
  ) {
    const { accountPublicKey, tokenId } = input;
    let { blockStatus } = input;
    const range = normalizeZkappCommandRange(input);

    blockStatus ||= BlockStatusFilter.all;
    return getZkappCommandsQuery(
      this.client,
      blockStatus,
      range.to,
      range.from,
      accountPublicKey?.toString(),
      tokenId?.toString()
    );
  }

  rowsToZkappCommands(rows: ZkappCommandDatabaseRow[]): ZkappCommands {
    const commandsByKey = new Map<string, ZkappCommand>();

    for (const row of rows) {
      const commandKey = `${row.state_hash}:${row.sequence_number}:${row.hash}`;
      let command = commandsByKey.get(commandKey);
      if (!command) {
        command = this.createZkappCommand(row);
        commandsByKey.set(commandKey, command);
      }

      command.accountUpdates.push({
        id: row.account_update_id.toString(),
        publicKey: row.public_key,
        tokenId: row.token_id,
        authorizationKind: row.authorization_kind,
        balanceChange: row.balance_change,
        incrementNonce: row.increment_nonce,
        callDepth: row.call_depth,
        actions: row.actions,
        events: row.events,
        appState: row.app_state,
        accountPrecondition: {
          state: row.account_precondition_state,
          actionState: row.account_precondition_action_state,
          provedState: row.account_precondition_proved_state,
          isNew: row.account_precondition_is_new,
        },
        networkPrecondition: {
          globalSlotSinceGenesis: {
            lowerBound: row.network_precondition_global_slot_lower_bound,
            upperBound: row.network_precondition_global_slot_upper_bound,
          },
        },
      });
    }

    return Array.from(commandsByKey.values());
  }

  private createZkappCommand(row: ZkappCommandDatabaseRow): ZkappCommand {
    return {
      blockInfo: this.createBlockInfo(row),
      hash: row.hash,
      feePayer: row.fee_payer,
      fee: row.fee,
      memo: row.memo,
      status: row.status,
      failureReason: row.failure_reason,
      sequenceNumber: row.sequence_number,
      accountUpdates: [],
    };
  }

  private createBlockInfo(row: ZkappCommandDatabaseRow): BlockInfo {
    return {
      height: Number(row.height),
      stateHash: row.state_hash,
      parentHash: row.parent_hash,
      ledgerHash: row.ledger_hash,
      chainStatus: row.chain_status,
      timestamp: row.timestamp,
      globalSlotSinceHardfork: Number(row.global_slot_since_hard_fork),
      globalSlotSinceGenesis: Number(row.global_slot_since_genesis),
      distanceFromMaxBlockHeight: Number(row.distance_from_max_block_height),
      lastVrfOutput: row.last_vrf_output,
    };
  }
}
