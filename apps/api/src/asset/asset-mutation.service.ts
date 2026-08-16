import { Inject, Injectable } from '@nestjs/common';

import type {
  AssetAmount,
  AssetMutationResult,
  AssetRepository,
  AssetReservationRequest,
  AssetReservationResult,
  ReservationLifecycleRequest,
} from '@dongtian/database';

import { assetRepositoryToken } from './asset.tokens.js';

@Injectable()
export class AssetMutationService {
  public constructor(@Inject(assetRepositoryToken) private readonly repository: AssetRepository) {}

  public add(input: AssetAmount): Promise<AssetMutationResult> {
    return this.repository.add(input);
  }

  public deduct(input: AssetAmount): Promise<AssetMutationResult> {
    return this.repository.deduct(input);
  }

  public reserve(input: AssetReservationRequest): Promise<AssetReservationResult> {
    return this.repository.reserve(input);
  }

  public release(input: ReservationLifecycleRequest): Promise<AssetReservationResult> {
    return this.repository.release(input);
  }

  public consume(input: ReservationLifecycleRequest): Promise<AssetReservationResult> {
    return this.repository.consume(input);
  }
}
